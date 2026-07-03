import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";

export const DEFAULT_BASE_URL = "https://app.skcal.fit";

export type OAuthCreds = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  clientId: string;
  tokenEndpoint: string;
};

export type Credentials = {
  baseUrl: string;
  savedAt: string;
  // Auth is one of: a `skcal_…` API key (non-interactive), OAuth tokens from the
  // browser flow, or a legacy token. The client sends whichever is present.
  apiKey?: string;
  oauth?: OAuthCreds;
  token?: string;
};

function configDir(): string {
  if (process.env.SKCAL_CONFIG_DIR) return process.env.SKCAL_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg || join(homedir(), ".config"), "skcal");
}

function credsPath(): string {
  return join(configDir(), "credentials.json");
}

export function loadCredentials(): Credentials | null {
  try {
    return JSON.parse(readFileSync(credsPath(), "utf8")) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  // 0600 so the cached Access token isn't world-readable.
  writeFileSync(credsPath(), JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
}

export function clearCredentials(): boolean {
  if (!existsSync(credsPath())) return false;
  rmSync(credsPath());
  return true;
}

/** Decode a JWT payload without verifying (the edge verifies; we just read claims). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Seconds until the token expires (negative if already expired), or null if unknown. */
export function secondsUntilExpiry(token: string): number | null {
  const claims = decodeJwt(token);
  const exp = claims && typeof claims.exp === "number" ? (claims.exp as number) : null;
  if (exp == null) return null;
  return exp - Math.floor(Date.now() / 1000);
}
