import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, mcp, phoneNumber } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { WorkerMailer } from "worker-mailer";
import * as schema from "../db/schema";

// Env bindings this module reads. Kept in sync with the worker's `Bindings`.
export type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  TWILIO_API_KEY_SID?: string;
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_VERIFY_SERVICE_SID?: string;
};

// Twilio Verify REST helper (shared with the linked-channels flow): Verify
// generates and checks its own codes, so Better Auth's generated OTP is unused.
export async function twilioVerify(
  env: Pick<AuthEnv, "TWILIO_API_KEY_SID" | "TWILIO_API_KEY_SECRET" | "TWILIO_VERIFY_SERVICE_SID">,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://verify.twilio.com/v2/Services/${env.TWILIO_VERIFY_SERVICE_SID}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.TWILIO_API_KEY_SID}:${env.TWILIO_API_KEY_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String((json as { message?: string }).message ?? `twilio ${path} → ${res.status}`));
  return json;
}

// Compose + send the magic-link email over SMTP using worker-mailer.
// Runs inside the Worker: worker-mailer opens the socket via `cloudflare:sockets`
// (needs the `nodejs_compat` compat flag, which is already set). Port 465 → SSL
// on connect; anything else (typically 587) → STARTTLS upgrade after EHLO.
async function sendMagicLinkEmail(env: AuthEnv, email: string, url: string): Promise<void> {
  const host = env.SMTP_HOST;
  const port = Number(env.SMTP_PORT) || 587;
  const from = env.SMTP_FROM || env.SMTP_USER;
  if (!host || !from) {
    // No SMTP configured (e.g. local dev without creds). Surface the link in the
    // Worker log so magic-link flows are still testable, and don't crash.
    console.warn(`[auth] SMTP not configured; magic-link for ${email}: ${url}`);
    return;
  }

  // Keep this minimal and light — no forced dark theme or full-bleed background,
  // so Gmail and other clients render it cleanly (and their own dark modes can
  // adapt it). Semantic, mostly-unstyled HTML with a single accent button.
  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;margin:0;padding:24px">
    <p style="margin:0 0 16px">Click the button below to sign in to skcal. This link expires shortly and can only be used once.</p>
    <p style="margin:0 0 20px">
      <a href="${url}" style="display:inline-block;padding:10px 20px;background:#f59e0b;color:#1a1205;text-decoration:none;border-radius:6px;font-weight:600">Sign in to skcal</a>
    </p>
    <p style="margin:0 0 6px;color:#666">Or paste this link into your browser:</p>
    <p style="margin:0;word-break:break-all"><a href="${url}">${url}</a></p>
    <p style="margin:24px 0 0;color:#999;font-size:13px">If you didn't request this, you can ignore this email.</p>
  </body>
</html>`;
  const text = `Sign in to skcal\n\nClick the link below to sign in. It expires shortly and can only be used once.\n\n${url}\n`;

  await WorkerMailer.send(
    {
      host,
      port,
      secure: port === 465, // implicit TLS on 465
      startTls: port !== 465, // STARTTLS on 587 (and others)
      authType: "plain", // Fastmail advertises AUTH PLAIN/LOGIN
      credentials:
        env.SMTP_USER && env.SMTP_PASS ? { username: env.SMTP_USER, password: env.SMTP_PASS } : undefined,
    },
    {
      from,
      to: email,
      subject: "Sign in to skcal",
      text,
      html,
    },
  );
}

// If the email has a Gravatar, return its URL, else null. Gravatar accepts a
// SHA-256 hex of the normalized email as the identifier; `d=404` makes it 404
// when the user has no avatar, which is how we detect "has one".
async function gravatarUrl(email: string): Promise<string | null> {
  try {
    const normalized = email.trim().toLowerCase();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const res = await fetch(`https://www.gravatar.com/avatar/${hash}?d=404`);
    return res.ok ? `https://www.gravatar.com/avatar/${hash}?s=200` : null;
  } catch {
    return null;
  }
}

// Build a Better Auth instance bound to this request's env. Cheap to construct
// per request (no I/O until an endpoint is hit), which suits Workers' isolate
// model where `env` only exists inside a request.
export function makeAuth(env: AuthEnv) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: ["https://admin.skcal.fit"],
    // Sessions effectively never expire: ~10-year lifetime, refreshed daily on
    // use so active sessions keep rolling forward forever.
    session: {
      expiresIn: 60 * 60 * 24 * 365 * 10,
      updateAge: 60 * 60 * 24,
    },
    // Session cookie is scoped to .skcal.fit so the admin subdomain (same
    // worker, different hostname) sees the same session.
    advanced: {
      crossSubDomainCookies: { enabled: true, domain: ".skcal.fit" },
    },
    // Magic-link accounts are inherently email-verified (the user proved control
    // of the inbox by clicking the link), so we don't send a separate
    // verification email. Google accounts arrive pre-verified from the provider.
    emailVerification: {
      sendOnSignUp: false,
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
      },
    },
    databaseHooks: {
      user: {
        create: {
          // On sign-up, backfill the profile picture from Gravatar when the
          // email has one (Google sign-ups already arrive with an image).
          before: async (user) => {
            if (user.image) return { data: user };
            const image = await gravatarUrl(user.email);
            return { data: image ? { ...user, image } : user };
          },
        },
      },
    },
    plugins: [
      // Primary sign-in: phone number + Twilio Verify OTP. Verify manages its
      // own codes, so sendOTP ignores Better Auth's generated code and
      // verifyOTP checks against Twilio instead.
      phoneNumber({
        sendOTP: async ({ phoneNumber: phone }) => {
          try {
            await twilioVerify(env, "Verifications", { To: phone, Channel: "sms" });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Twilio Verify rate limit: ~5 sends per number, then locked ~10 min.
            if (/max send attempts/i.test(msg) || /60203|20429/.test(msg)) {
              throw new APIError("TOO_MANY_REQUESTS", {
                message: "Too many codes requested for this number — wait about 10 minutes and try again.",
              });
            }
            console.error("send-otp failed:", msg);
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Couldn't send the code — try again in a minute.",
            });
          }
        },
        verifyOTP: async ({ phoneNumber: phone, code }) => {
          try {
            const check = await twilioVerify(env, "VerificationCheck", { To: phone, Code: code });
            if (check.status !== "approved") return false;
          } catch {
            return false;
          }
          // Existing-account mapping: if this number is already a verified
          // linked channel (agent texting) and no account uses it for sign-in
          // yet, adopt it — the session then lands on that account instead of
          // minting a fresh one.
          try {
            const db = drizzle(env.DB, { schema });
            const taken = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.phoneNumber, phone)).limit(1);
            if (!taken.length) {
              const chan = await db
                .select()
                .from(schema.linkedChannels)
                .where(and(eq(schema.linkedChannels.kind, "phone"), eq(schema.linkedChannels.value, phone)))
                .limit(1);
              if (chan.length) {
                await db
                  .update(schema.user)
                  .set({ phoneNumber: phone, phoneNumberVerified: true })
                  .where(eq(schema.user.email, chan[0].userEmail));
              }
            }
          } catch {
            /* best-effort mapping; a fresh account is the fallback */
          }
          return true;
        },
        signUpOnVerification: {
          getTempEmail: (phone) => `${phone.replace(/\D/g, "")}@phone.skcal.fit`,
          getTempName: (phone) => phone,
        },
        // Auto-link the verified number as an agent channel so texting the
        // iMessage agent works immediately after phone sign-in.
        callbackOnVerification: async ({ phoneNumber: phone, user }) => {
          try {
            const db = drizzle(env.DB, { schema });
            const existing = await db
              .select({ id: schema.linkedChannels.id })
              .from(schema.linkedChannels)
              .where(and(eq(schema.linkedChannels.kind, "phone"), eq(schema.linkedChannels.value, phone)))
              .limit(1);
            if (!existing.length) {
              await db.insert(schema.linkedChannels).values({
                id: crypto.randomUUID(),
                userEmail: user.email,
                kind: "phone",
                value: phone,
                verifiedAt: new Date(),
              });
            }
          } catch {
            /* linking is best-effort; the profile UI can do it later */
          }
        },
      }),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLinkEmail(env, email, url);
        },
      }),
      // OAuth 2.1 for MCP clients: exposes discovery + token endpoints and lets
      // clients install the skcal MCP server, authorizing via the same login.
      // The sign-in gate lives at "/". Cast to the generic plugin type so the
      // mcp plugin's (non-exported) options type doesn't leak into makeAuth's
      // emitted declaration (composite build). Runtime behavior is unchanged.
      mcp({ loginPage: "/" }) as BetterAuthPlugin,
    ],
  });
}

export type Auth = ReturnType<typeof makeAuth>;
