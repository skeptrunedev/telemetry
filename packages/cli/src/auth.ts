import { createServer } from "node:http";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { AddressInfo } from "node:net";

const SUCCESS_HTML = `<!doctype html><meta charset="utf-8"><title>skcal CLI</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;background:#0a0a0b;color:#ececE7;
display:grid;place-items:center;height:100vh;margin:0}div{text-align:center}h1{font-weight:500}
small{color:#8a8a90}</style>
<div><h1>Signed in to skcal CLI</h1><small>You can close this tab and return to the terminal.</small></div>`;

/** Open a URL in the user's default browser, cross-platform. */
function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* fall through — the URL is printed for manual opening */
  }
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const SCOPE = "openid profile email offline_access";

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  clientId: string;
  tokenEndpoint: string;
};

type AuthServerMeta = { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string };
type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };

async function discover(root: string): Promise<AuthServerMeta> {
  const res = await fetch(`${root}/.well-known/oauth-authorization-server`);
  if (!res.ok) throw new Error(`OAuth discovery failed (${res.status})`);
  return (await res.json()) as AuthServerMeta;
}

async function registerClient(endpoint: string, redirectUri: string): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "skcal CLI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`Client registration failed (${res.status}): ${await res.text().catch(() => "")}`);
  const j = (await res.json()) as { client_id?: string };
  if (!j.client_id) throw new Error("Client registration returned no client_id");
  return j.client_id;
}

async function postToken(endpoint: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${await res.text().catch(() => "")}`);
  return (await res.json()) as TokenResponse;
}

/**
 * Browser sign-in via OAuth 2.1 (authorization code + PKCE) against skcal's MCP
 * OAuth server. Starts a one-shot loopback server, dynamically registers a
 * client bound to that redirect URI, opens the authorize URL (which forces the
 * skcal login + consent), then exchanges the returned code for tokens.
 */
export function browserLogin(
  baseUrl: string,
  timeoutMs = 180_000,
  open: (url: string) => void = openBrowser,
): Promise<OAuthTokens> {
  const root = baseUrl.replace(/\/$/, "");
  return new Promise((resolve, reject) => {
    let settled = false;
    const state = randomUUID();
    const codeVerifier = b64url(randomBytes(32));
    const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());
    let meta: AuthServerMeta;
    let clientId: string;
    let redirectUri: string;

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "content-type": "text/plain" }).end(`Login error: ${err}`);
        finish(() => reject(new Error(`Authorization failed: ${err}`)));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/plain" }).end("Invalid login callback.");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(SUCCESS_HTML);
      try {
        const tok = await postToken(meta.token_endpoint, {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: codeVerifier,
        });
        finish(() =>
          resolve({
            accessToken: tok.access_token,
            refreshToken: tok.refresh_token,
            expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined,
            clientId,
            tokenEndpoint: meta.token_endpoint,
          }),
        );
      } catch (e) {
        finish(() => reject(e));
      }
    });

    const timer = setTimeout(() => finish(() => reject(new Error("Login timed out. Run `skcal login` again."))), timeoutMs);
    function finish(done: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      done();
    }
    server.on("error", (e) => finish(() => reject(e)));

    server.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address() as AddressInfo;
        redirectUri = `http://127.0.0.1:${port}/callback`;
        meta = await discover(root);
        if (!meta.registration_endpoint) throw new Error("Server doesn't support dynamic client registration");
        clientId = await registerClient(meta.registration_endpoint, redirectUri);
        const authorizeUrl = `${meta.authorization_endpoint}?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state,
          scope: SCOPE,
        }).toString()}`;
        process.stderr.write(`Opening browser to sign in…\nIf it doesn't open, visit:\n  ${authorizeUrl}\n\n`);
        open(authorizeUrl);
      } catch (e) {
        finish(() => reject(e));
      }
    });
  });
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshAccessToken(o: {
  refreshToken: string;
  clientId: string;
  tokenEndpoint: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  const t = await postToken(o.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: o.refreshToken,
    client_id: o.clientId,
  });
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
  };
}
