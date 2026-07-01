import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeJwt,
  secondsUntilExpiry,
  saveCredentials,
  loadCredentials,
  clearCredentials,
} from "../src/config";

/** Build an unsigned JWT-shaped token with the given payload (header.payload.sig). */
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.sig`;
}

describe("decodeJwt", () => {
  it("decodes the payload claims", () => {
    const token = makeJwt({ email: "nick@mintlify.com", exp: 1790000000 });
    expect(decodeJwt(token)).toEqual({ email: "nick@mintlify.com", exp: 1790000000 });
  });

  it("returns null for a non-JWT string", () => {
    expect(decodeJwt("not-a-jwt")).toBeNull();
  });
});

describe("secondsUntilExpiry", () => {
  it("returns a positive number for a future exp", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const secs = secondsUntilExpiry(makeJwt({ exp: future }));
    expect(secs).not.toBeNull();
    expect(secs!).toBeGreaterThan(3000);
    expect(secs!).toBeLessThanOrEqual(3600);
  });

  it("returns a negative number for an already-expired token", () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    expect(secondsUntilExpiry(makeJwt({ exp: past }))!).toBeLessThan(0);
  });

  it("returns null when there is no exp claim", () => {
    expect(secondsUntilExpiry(makeJwt({ email: "x@y.com" }))).toBeNull();
  });
});

describe("credentials round-trip", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skcal-cli-test-"));
    process.env.SKCAL_CONFIG_DIR = dir;
  });

  afterEach(() => {
    delete process.env.SKCAL_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("save → load returns the same credentials", () => {
    expect(loadCredentials()).toBeNull();
    const creds = { baseUrl: "https://skcal.skeptrune.com", token: "tok123", savedAt: "2026-06-29T00:00:00Z" };
    saveCredentials(creds);
    expect(loadCredentials()).toEqual(creds);
  });

  it("writes the credentials file with 0600 permissions", () => {
    saveCredentials({ baseUrl: "https://x", token: "t", savedAt: "now" });
    const file = join(dir, "credentials.json");
    expect(existsSync(file)).toBe(true);
    // Mode low bits should be 0600 (owner read/write only).
    const { statSync } = require("node:fs") as typeof import("node:fs");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    // Sanity: the JSON is valid and contains the token.
    expect(JSON.parse(readFileSync(file, "utf8")).token).toBe("t");
  });

  it("clear removes the file and reports whether one existed", () => {
    expect(clearCredentials()).toBe(false);
    saveCredentials({ baseUrl: "https://x", token: "t", savedAt: "now" });
    expect(clearCredentials()).toBe(true);
    expect(loadCredentials()).toBeNull();
  });
});
