import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TelemetryClient, NotAuthenticatedError, ApiError } from "../src/client";

// A tiny local HTTP mock standing in for the Worker API. Canned JSON per route;
// no real network beyond loopback.
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === "/api/whoami") return send(200, { email: "nick@mintlify.com" });
    if (req.method === "GET" && url.pathname === "/api/weight")
      return send(200, [{ id: 1, ts: 1782000000000, weightKg: 72.6, bodyFatPct: null, note: "am", source: "manual" }]);
    if (req.method === "POST" && url.pathname === "/api/weight") return send(200, { ok: true });
    if (req.method === "GET" && url.pathname === "/api/targets")
      return send(200, { goalWeightKg: 66.7, startWeightKg: 72.6, dailyKcalTarget: 1850, proteinTargetG: 160 });
    // Simulate an Access login redirect → token rejected/expired.
    if (url.pathname === "/api/needs-auth") return res.writeHead(302, { location: "https://login" }).end();
    // Simulate a plain 401.
    if (url.pathname === "/api/unauthorized") return send(401, { error: "nope" });
    // Simulate an application error (validation).
    if (url.pathname === "/api/bad") return send(400, { error: "weightKg must be 9–320 kg" });
    return send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

function client() {
  return new TelemetryClient(baseUrl, "fake-token");
}

describe("TelemetryClient typed methods", () => {
  it("whoami parses the email", async () => {
    expect(await client().whoami()).toEqual({ email: "nick@mintlify.com" });
  });

  it("listWeight parses the readings array", async () => {
    const rows = await client().listWeight();
    expect(rows).toHaveLength(1);
    expect(rows[0].weightKg).toBe(72.6);
    expect(rows[0].source).toBe("manual");
  });

  it("addWeight returns { ok: true }", async () => {
    expect(await client().addWeight(72.6, null, "am")).toEqual({ ok: true });
  });

  it("targets parses defaults", async () => {
    const t = await client().targets();
    expect(t.proteinTargetG).toBe(160);
    expect(t.dailyKcalTarget).toBe(1850);
  });
});

describe("TelemetryClient error handling", () => {
  it("throws NotAuthenticatedError on a redirect (Access login bounce)", async () => {
    // request() is private; exercise it via a method pointed at the redirect path.
    const c = new TelemetryClient(baseUrl, "fake-token");
    // @ts-expect-error reach into the private request() to test the redirect guard
    await expect(c.request("GET", "/api/needs-auth")).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it("throws NotAuthenticatedError on a 401", async () => {
    const c = new TelemetryClient(baseUrl, "fake-token");
    // @ts-expect-error reach into the private request() to test the 401 guard
    await expect(c.request("GET", "/api/unauthorized")).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it("throws ApiError with the server error message on a 400", async () => {
    const c = new TelemetryClient(baseUrl, "fake-token");
    // @ts-expect-error reach into the private request() to test the error envelope
    await expect(c.request("GET", "/api/bad")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "weightKg must be 9–320 kg",
    });
    // And it really is an ApiError instance.
    // @ts-expect-error private
    await expect(c.request("GET", "/api/bad")).rejects.toBeInstanceOf(ApiError);
  });
});
