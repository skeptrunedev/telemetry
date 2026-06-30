import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { AddressInfo } from "node:net";

const SUCCESS_HTML = `<!doctype html><meta charset="utf-8"><title>Telemetry CLI</title>
<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;background:#0a0a0b;color:#ececE7;
display:grid;place-items:center;height:100vh;margin:0}div{text-align:center}h1{font-weight:500}
small{color:#8a8a90}</style>
<div><h1>Signed in to Telemetry CLI</h1><small>You can close this tab and return to the terminal.</small></div>`;

/** Open a URL in the user's default browser, cross-platform. */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* fall through — the URL is printed for manual opening */
  }
}

export type LoginResult = { token: string };

/**
 * Browser SSO against Cloudflare Access — no API key.
 *
 * We start a one-shot loopback server, open `${baseUrl}/cli-auth?...` in the
 * browser (which forces Access SSO), and the worker's /cli-auth route bounces
 * the verified Access token back to our /callback. We match `state` to reject
 * anything we didn't initiate.
 */
export function browserLogin(
  baseUrl: string,
  timeoutMs = 120_000,
  // Injectable for tests; defaults to the real cross-platform browser opener so
  // external behavior is unchanged.
  open: (url: string) => void = openBrowser,
): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const state = randomUUID();
    let settled = false;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const token = url.searchParams.get("token");
      const gotState = url.searchParams.get("state");
      if (!token || gotState !== state) {
        res.writeHead(400, { "content-type": "text/plain" }).end("Invalid login callback.");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(SUCCESS_HTML);
      finish(() => resolve({ token }));
    });

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Login timed out. Run `telemetry login` again.")));
    }, timeoutMs);

    function finish(done: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      done();
    }

    server.on("error", (e) => finish(() => reject(e)));

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const loginUrl = `${baseUrl.replace(/\/$/, "")}/cli-auth?port=${port}&state=${state}`;
      process.stderr.write(`Opening browser to sign in…\nIf it doesn't open, visit:\n  ${loginUrl}\n\n`);
      open(loginUrl);
    });
  });
}
