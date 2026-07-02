import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
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
};

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

// Build a Better Auth instance bound to this request's env. Cheap to construct
// per request (no I/O until an endpoint is hit), which suits Workers' isolate
// model where `env` only exists inside a request.
export function makeAuth(env: AuthEnv) {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
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
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLinkEmail(env, email, url);
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof makeAuth>;
