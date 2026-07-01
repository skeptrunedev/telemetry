import { describe, expect, it } from "vitest";
import { get } from "node:http";
import { browserLogin } from "../src/auth";

// We avoid a real browser by injecting an `open` callback into browserLogin.
// The injected opener parses the port + state out of the /cli-auth URL the CLI
// would have opened, then immediately hits the CLI's own loopback /callback —
// exactly what the Worker's /cli-auth redirect does in production.

/** Parse `?port=...&state=...` out of the login URL. */
function parseLoginUrl(loginUrl: string) {
  const u = new URL(loginUrl);
  return { port: u.searchParams.get("port")!, state: u.searchParams.get("state")! };
}

function hitCallback(port: string, query: string) {
  return new Promise<void>((resolve) => {
    get(`http://127.0.0.1:${port}/callback?${query}`, (res) => {
      res.resume();
      res.on("end", () => resolve());
    });
  });
}

describe("browserLogin", () => {
  it("resolves with { token } when the callback carries a matching state", async () => {
    const opener = (loginUrl: string) => {
      const { port, state } = parseLoginUrl(loginUrl);
      void hitCallback(port, `token=T&state=${state}`);
    };
    const result = await browserLogin("https://skcal.skeptrune.com", 5_000, opener);
    expect(result).toEqual({ token: "T" });
  });

  it("does NOT resolve when the callback state does not match (times out)", async () => {
    const opener = (loginUrl: string) => {
      const { port } = parseLoginUrl(loginUrl);
      // Wrong state → the one-shot server replies 400 and does not settle.
      void hitCallback(port, `token=T&state=WRONG`);
    };
    // Short timeout: a mismatched state must make browserLogin reject by timing out.
    await expect(browserLogin("https://skcal.skeptrune.com", 300, opener)).rejects.toThrow(/timed out/i);
  });
});
