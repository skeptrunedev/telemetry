import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "node:http";
import { browserLogin } from "../src/auth";

// We avoid a real browser by injecting an `open` callback into browserLogin,
// and avoid the network by mocking fetch for the three OAuth server calls
// (discovery, dynamic client registration, token exchange). The injected
// opener parses the loopback redirect_uri + state out of the authorize URL the
// CLI would have opened, then hits the CLI's own /callback with a code —
// exactly what the real authorization server redirect does.

const BASE = "https://skcal.example";

function mockOAuthServer() {
  const calls: { tokenBody?: URLSearchParams } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${BASE}/.well-known/oauth-authorization-server`) {
        return Response.json({
          authorization_endpoint: `${BASE}/api/auth/mcp/authorize`,
          token_endpoint: `${BASE}/api/auth/mcp/token`,
          registration_endpoint: `${BASE}/api/auth/mcp/register`,
        });
      }
      if (url === `${BASE}/api/auth/mcp/register`) {
        return Response.json({ client_id: "client-123" });
      }
      if (url === `${BASE}/api/auth/mcp/token`) {
        calls.tokenBody = new URLSearchParams(String(init?.body));
        return Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return calls;
}

/** Parse the loopback callback port + state out of the authorize URL. */
function parseAuthorizeUrl(authorizeUrl: string) {
  const u = new URL(authorizeUrl);
  const redirect = new URL(u.searchParams.get("redirect_uri")!);
  return { port: redirect.port, state: u.searchParams.get("state")! };
}

function hitCallback(port: string, query: string) {
  return new Promise<void>((resolve) => {
    get(`http://127.0.0.1:${port}/callback?${query}`, (res) => {
      res.resume();
      res.on("end", () => resolve());
    });
  });
}

describe("browserLogin (OAuth 2.1 + PKCE)", () => {
  beforeEach(() => {
    mockOAuthServer();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers a client, exchanges the code, and resolves with tokens", async () => {
    const opener = (authorizeUrl: string) => {
      const { port, state } = parseAuthorizeUrl(authorizeUrl);
      void hitCallback(port, `code=C&state=${state}`);
    };
    const result = await browserLogin(BASE, 5_000, opener);
    expect(result.accessToken).toBe("AT");
    expect(result.refreshToken).toBe("RT");
    expect(result.clientId).toBe("client-123");
    expect(result.tokenEndpoint).toBe(`${BASE}/api/auth/mcp/token`);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("sends the PKCE verifier and code in the token exchange", async () => {
    const calls = mockOAuthServer();
    const opener = (authorizeUrl: string) => {
      const { port, state } = parseAuthorizeUrl(authorizeUrl);
      void hitCallback(port, `code=C42&state=${state}`);
    };
    await browserLogin(BASE, 5_000, opener);
    expect(calls.tokenBody?.get("grant_type")).toBe("authorization_code");
    expect(calls.tokenBody?.get("code")).toBe("C42");
    expect(calls.tokenBody?.get("client_id")).toBe("client-123");
    expect(calls.tokenBody?.get("code_verifier")).toBeTruthy();
  });

  it("does NOT resolve when the callback state does not match (times out)", async () => {
    const opener = (authorizeUrl: string) => {
      const { port } = parseAuthorizeUrl(authorizeUrl);
      // Wrong state → the one-shot server replies 400 and does not settle.
      void hitCallback(port, `code=C&state=WRONG`);
    };
    await expect(browserLogin(BASE, 300, opener)).rejects.toThrow(/timed out/i);
  });

  it("rejects when the callback carries an OAuth error", async () => {
    const opener = (authorizeUrl: string) => {
      const { port, state } = parseAuthorizeUrl(authorizeUrl);
      void hitCallback(port, `error=access_denied&state=${state}`);
    };
    await expect(browserLogin(BASE, 5_000, opener)).rejects.toThrow(/access_denied/);
  });
});
