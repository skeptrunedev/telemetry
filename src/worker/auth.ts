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

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#17181a;color:#ececec;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:32px">
    <div style="max-width:460px;margin:0 auto;background:#1f2123;border:1px solid #303236;border-radius:16px;padding:28px">
      <p style="font-size:12px;letter-spacing:.14em;color:#9a9ca0;margin:0 0 6px;text-transform:uppercase">Telemetry</p>
      <h1 style="font-size:20px;margin:0 0 14px;color:#ececec">Sign in to Telemetry</h1>
      <p style="font-size:14px;line-height:1.6;color:#9a9ca0;margin:0 0 22px">Click the button below to sign in. This link expires shortly and can only be used once.</p>
      <a href="${url}" style="display:inline-block;background:#f59e0b;color:#1a1205;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">Sign in</a>
      <p style="font-size:12px;line-height:1.6;color:#6c6f73;margin:22px 0 0;word-break:break-all">Or paste this link into your browser:<br>${url}</p>
    </div>
  </body>
</html>`;
  const text = `Sign in to Telemetry\n\nClick the link below to sign in. It expires shortly and can only be used once.\n\n${url}\n`;

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
      subject: "Sign in to Telemetry",
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
