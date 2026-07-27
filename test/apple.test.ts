import { describe, expect, it } from "vitest";
import {
  APPLE_BUNDLE_ID,
  anyBillingRowActive,
  appleBillingState,
  appleIapConfigured,
  appleJwtParts,
  appleJwtSigningInput,
  appleStatusCodeToBilling,
  billingRowActive,
  decodeJwsPayload,
  signAppleJwt,
  type AppleTransactionInfo,
} from "../src/worker/apple";
import { seedBillingRow, workerFetchBilling } from "./harness";

// Apple in-app purchase. Everything provable without Apple's servers is proven
// here: JWT construction and signing, the notification/transaction to billing
// state mapping, and source-aware entitlement.
//
// NOT covered, and not coverable until the Paid Applications Agreement is signed
// and a subscription product exists: any real round trip against the App Store
// Server API, and any real StoreKit purchase.

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-26T12:00:00Z");

// ---- base64url / JWS --------------------------------------------------------

describe("apple: JWS decoding", () => {
  it("reads the payload out of a three-part JWS", () => {
    const b64u = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const jws = `${b64u({ alg: "ES256" })}.${b64u({ transactionId: "2000000900000001" })}.sig`;
    expect(decodeJwsPayload<{ transactionId: string }>(jws).transactionId).toBe("2000000900000001");
  });

  it("rejects anything that is not a three-part JWS", () => {
    expect(() => decodeJwsPayload("nope")).toThrow();
    expect(() => decodeJwsPayload("a.b")).toThrow();
  });
});

// ---- JWT construction + signing --------------------------------------------

describe("apple: App Store Server API JWT", () => {
  it("builds the exact header and payload Apple documents", () => {
    const parts = appleJwtParts("ABC123KEY", "issuer-uuid", NOW);
    expect(parts.header).toEqual({ alg: "ES256", kid: "ABC123KEY", typ: "JWT" });
    expect(parts.payload.iss).toBe("issuer-uuid");
    expect(parts.payload.aud).toBe("appstoreconnect-v1");
    expect(parts.payload.bid).toBe(APPLE_BUNDLE_ID);
    expect(parts.payload.iat).toBe(Math.floor(NOW / 1000));
    // Apple rejects tokens valid for more than an hour.
    expect(parts.payload.exp - parts.payload.iat).toBeGreaterThan(0);
    expect(parts.payload.exp - parts.payload.iat).toBeLessThanOrEqual(3600);
  });

  it("signing input is base64url header.payload with no padding", () => {
    const input = appleJwtSigningInput(appleJwtParts("K", "I", NOW));
    expect(input.split(".")).toHaveLength(2);
    expect(input).not.toContain("=");
    expect(input).not.toContain("+");
    expect(input).not.toContain("/");
    const header = JSON.parse(Buffer.from(input.split(".")[0], "base64url").toString());
    expect(header.alg).toBe("ES256");
  });

  it("appleIapConfigured needs all three secrets", () => {
    expect(appleIapConfigured({})).toBe(false);
    expect(appleIapConfigured({ APPLE_IAP_KEY_ID: "k", APPLE_IAP_ISSUER_ID: "i" })).toBe(false);
    expect(appleIapConfigured({ APPLE_IAP_KEY_ID: "k", APPLE_IAP_ISSUER_ID: "i", APPLE_IAP_PRIVATE_KEY: "p" })).toBe(
      true,
    );
  });

  it("signAppleJwt produces an ES256 JWS that verifies against the public key", async () => {
    // A throwaway P-256 key in the same PKCS#8 PEM shape Apple hands out as .p8.
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----`;

    const jwt = await signAppleJwt(
      { APPLE_IAP_KEY_ID: "KEYID12345", APPLE_IAP_ISSUER_ID: "issuer-uuid", APPLE_IAP_PRIVATE_KEY: pem },
      NOW,
    );
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString()).kid).toBe("KEYID12345");
    expect(JSON.parse(Buffer.from(p, "base64url").toString()).aud).toBe("appstoreconnect-v1");
    // Raw r||s, 64 bytes for P-256 — the JWS ES256 form, not DER.
    expect(Buffer.from(s, "base64url")).toHaveLength(64);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pair.publicKey,
      Buffer.from(s, "base64url"),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("accepts a key stored with literal \\n escapes", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
    const escaped = `-----BEGIN PRIVATE KEY-----\\n${pkcs8}\\n-----END PRIVATE KEY-----`;
    await expect(
      signAppleJwt({ APPLE_IAP_KEY_ID: "k", APPLE_IAP_ISSUER_ID: "i", APPLE_IAP_PRIVATE_KEY: escaped }, NOW),
    ).resolves.toContain(".");
  });

  it("refuses to sign when the secrets are missing", async () => {
    await expect(signAppleJwt({}, NOW)).rejects.toThrow(/not configured/);
  });
});

// ---- notification / transaction → billing state -----------------------------

function tx(over: Partial<AppleTransactionInfo> = {}): AppleTransactionInfo {
  return {
    transactionId: "2000000900000001",
    originalTransactionId: "2000000800000001",
    bundleId: APPLE_BUNDLE_ID,
    productId: "fit.skcal.app.monthly",
    purchaseDate: NOW - DAY,
    expiresDate: NOW + 29 * DAY,
    type: "Auto-Renewable Subscription",
    ...over,
  };
}

describe("apple: status code mapping", () => {
  it("maps Apple's subscription status codes", () => {
    expect(appleStatusCodeToBilling(1)).toBe("active");
    expect(appleStatusCodeToBilling(2)).toBe("expired");
    expect(appleStatusCodeToBilling(3)).toBe("billing_retry");
    expect(appleStatusCodeToBilling(4)).toBe("grace_period");
    expect(appleStatusCodeToBilling(5)).toBe("revoked");
  });

  it("fails closed on a status code Apple has not shipped yet", () => {
    expect(appleStatusCodeToBilling(99)).toBe("expired");
    expect(appleStatusCodeToBilling(0)).toBe("expired");
  });
});

describe("apple: notification → billing state", () => {
  it("SUBSCRIBED / DID_RENEW with status 1 is active through the new period end", () => {
    const state = appleBillingState(tx({ expiresDate: NOW + 30 * DAY }), {
      statusCode: 1,
      notificationType: "DID_RENEW",
      now: NOW,
    });
    expect(state).toEqual({ status: "active", currentPeriodEnd: NOW + 30 * DAY });
  });

  it("a free-trial transaction reports trialing rather than active", () => {
    expect(appleBillingState(tx({ offerDiscountType: "FREE_TRIAL" }), { statusCode: 1, now: NOW }).status).toBe(
      "trialing",
    );
    expect(appleBillingState(tx({ offerType: 1 }), { statusCode: 1, now: NOW }).status).toBe("trialing");
  });

  it("turning auto-renew off does NOT revoke: access lasts to the period end", () => {
    // This is the cancellation case App Review actually exercises. Apple keeps
    // status 1 until the paid period runs out, and so must we.
    const state = appleBillingState(tx(), {
      statusCode: 1,
      notificationType: "DID_CHANGE_RENEWAL_STATUS",
      subtype: "AUTO_RENEW_DISABLED",
      now: NOW,
    });
    expect(state.status).toBe("active");
    expect(billingRowActive({ status: state.status, currentPeriodEnd: state.currentPeriodEnd }, NOW)).toBe(true);
  });

  it("DID_FAIL_TO_RENEW with a grace period keeps access", () => {
    const state = appleBillingState(tx({ expiresDate: NOW - DAY }), {
      statusCode: 4,
      notificationType: "DID_FAIL_TO_RENEW",
      subtype: "GRACE_PERIOD",
      now: NOW,
    });
    expect(state.status).toBe("grace_period");
    expect(billingRowActive({ status: state.status, currentPeriodEnd: state.currentPeriodEnd }, NOW)).toBe(true);
  });

  it("DID_FAIL_TO_RENEW without a grace period is billing retry", () => {
    const state = appleBillingState(tx({ expiresDate: NOW - DAY }), {
      statusCode: 3,
      notificationType: "DID_FAIL_TO_RENEW",
      now: NOW,
    });
    expect(state.status).toBe("billing_retry");
    // Short courtesy window, then it lapses.
    expect(billingRowActive({ status: "billing_retry", currentPeriodEnd: NOW - DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "billing_retry", currentPeriodEnd: NOW - 10 * DAY }, NOW)).toBe(false);
  });

  it("EXPIRED and GRACE_PERIOD_EXPIRED end access", () => {
    const expired = appleBillingState(tx({ expiresDate: NOW - DAY }), {
      statusCode: 2,
      notificationType: "EXPIRED",
      subtype: "VOLUNTARY",
      now: NOW,
    });
    expect(expired.status).toBe("expired");
    expect(billingRowActive({ status: expired.status, currentPeriodEnd: expired.currentPeriodEnd }, NOW)).toBe(false);

    const graceOver = appleBillingState(tx({ expiresDate: NOW - DAY }), {
      notificationType: "GRACE_PERIOD_EXPIRED",
      now: NOW,
    });
    expect(graceOver.status).toBe("expired");
  });

  it("REFUND and REVOKE revoke immediately, even mid-period", () => {
    for (const notificationType of ["REFUND", "REVOKE"]) {
      const state = appleBillingState(tx({ expiresDate: NOW + 20 * DAY }), { notificationType, now: NOW });
      expect(state.status).toBe("revoked");
      expect(billingRowActive({ status: state.status, currentPeriodEnd: state.currentPeriodEnd }, NOW)).toBe(false);
    }
  });

  it("a revocationDate on the transaction beats an 'active' status code", () => {
    const state = appleBillingState(tx({ revocationDate: NOW - 60_000 }), { statusCode: 1, now: NOW });
    expect(state.status).toBe("revoked");
  });

  it("with no status code it falls back to the expiry date on the transaction", () => {
    expect(appleBillingState(tx({ expiresDate: NOW + DAY }), { now: NOW }).status).toBe("active");
    expect(appleBillingState(tx({ expiresDate: NOW - DAY }), { now: NOW }).status).toBe("expired");
  });
});

// ---- source-aware entitlement -----------------------------------------------

describe("apple: source-aware entitlement", () => {
  it("a row only grants access for statuses that should grant access", () => {
    expect(billingRowActive({ status: "active", currentPeriodEnd: NOW + DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "trialing", currentPeriodEnd: NOW + DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "past_due", currentPeriodEnd: NOW - 30 * DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "grace_period", currentPeriodEnd: NOW - DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "canceled", currentPeriodEnd: NOW + DAY }, NOW)).toBe(false);
    expect(billingRowActive({ status: "expired", currentPeriodEnd: NOW - DAY }, NOW)).toBe(false);
    expect(billingRowActive({ status: "revoked", currentPeriodEnd: NOW + DAY }, NOW)).toBe(false);
    expect(billingRowActive({ status: null }, NOW)).toBe(false);
    expect(billingRowActive(undefined, NOW)).toBe(false);
  });

  it("keeps a 3-day slop past the period end so renewal lag never locks anyone out", () => {
    expect(billingRowActive({ status: "active", currentPeriodEnd: NOW - 2 * DAY }, NOW)).toBe(true);
    expect(billingRowActive({ status: "active", currentPeriodEnd: NOW - 4 * DAY }, NOW)).toBe(false);
  });

  it("accepts Date as well as epoch ms (Drizzle hands back Date)", () => {
    expect(billingRowActive({ status: "active", currentPeriodEnd: new Date(NOW + DAY) }, NOW)).toBe(true);
  });

  it("an active Apple row is not cancelled out by a dead Stripe row", () => {
    const rows = [
      { status: "canceled", currentPeriodEnd: NOW - 40 * DAY },
      { status: "active", currentPeriodEnd: NOW + 20 * DAY },
    ];
    expect(anyBillingRowActive(rows, NOW)).toBe(true);
    // and the reverse ordering
    expect(anyBillingRowActive([...rows].reverse(), NOW)).toBe(true);
  });

  it("all sources dead means no access", () => {
    expect(
      anyBillingRowActive(
        [
          { status: "canceled", currentPeriodEnd: NOW - 40 * DAY },
          { status: "expired", currentPeriodEnd: NOW - 5 * DAY },
        ],
        NOW,
      ),
    ).toBe(false);
    expect(anyBillingRowActive([], NOW)).toBe(false);
  });
});

// ---- routes (gate live, IAP keys absent) ------------------------------------
// These run against a Worker instance with STRIPE_SECRET_KEY bound, which turns
// the 402 subscription gate on. @phone.skcal.fit accounts are deliberately not
// exempted by the dev bypass, so they exercise the real gate.

const phone = (n: string) => `1555000${n}@phone.skcal.fit`;

function asPhoneUser(email: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", email);
  return workerFetchBilling(path, { ...init, headers });
}

describe("apple: routes without IAP keys configured", () => {
  it("POST /api/apple/verify → 503 iap_not_configured, not a 500 or a 402", async () => {
    const res = await asPhoneUser(phone("100"), "/api/apple/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId: "2000000900000001" }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "IAP not configured", code: "iap_not_configured" });
  });

  it("POST /api/apple/notifications → 503 and needs no session at all", async () => {
    const res = await workerFetchBilling("/api/apple/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedPayload: "a.b.c" }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("iap_not_configured");
  });

  it("GET /api/apple/config reports unconfigured but still hands back the product id", async () => {
    const res = await asPhoneUser(phone("101"), "/api/apple/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; bundleId: string; productIds: string[] };
    expect(body.configured).toBe(false);
    expect(body.bundleId).toBe("fit.skcal.app");
    expect(body.productIds).toContain("fit.skcal.app.monthly");
  });

  it("appAccountToken is a stable UUID per account and differs between accounts", async () => {
    const read = async (email: string) =>
      ((await (await asPhoneUser(email, "/api/apple/config")).json()) as { appAccountToken: string }).appAccountToken;
    const a1 = await read(phone("102"));
    const a2 = await read(phone("102"));
    const b1 = await read(phone("103"));
    expect(a1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
  });
});

describe("apple: the 402 gate", () => {
  it("an unsubscribed account is blocked from data routes", async () => {
    const res = await asPhoneUser(phone("200"), "/api/dashboard");
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "subscription required" });
  });

  it("but can still reach /api/apple/* to buy or restore", async () => {
    // 503 (keys absent) rather than 402 is the point of this assertion: an
    // unsubscribed user must be able to run the purchase flow.
    const res = await asPhoneUser(phone("200"), "/api/apple/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId: "1" }),
    });
    expect(res.status).toBe(503);
  });

  it("an active Apple row alone opens the gate", async () => {
    const email = phone("201");
    await seedBillingRow({
      userEmail: email,
      source: "apple",
      status: "active",
      currentPeriodEnd: Date.now() + 25 * DAY,
      subscriptionId: "2000000800000201",
    });
    expect((await asPhoneUser(email, "/api/dashboard")).status).toBe(200);
  });

  it("an expired Stripe row cannot clobber a live Apple row", async () => {
    const email = phone("202");
    await seedBillingRow({ userEmail: email, source: "stripe", status: "canceled", currentPeriodEnd: Date.now() - 40 * DAY });
    await seedBillingRow({ userEmail: email, source: "apple", status: "active", currentPeriodEnd: Date.now() + 25 * DAY });
    expect((await asPhoneUser(email, "/api/dashboard")).status).toBe(200);
    const billing = (await (await asPhoneUser(email, "/api/billing")).json()) as {
      active: boolean;
      source: string;
      status: string;
    };
    expect(billing.active).toBe(true);
    expect(billing.source).toBe("apple");
    expect(billing.status).toBe("active");
  });

  it("a revoked Apple row cannot clobber a live Stripe row", async () => {
    const email = phone("203");
    await seedBillingRow({ userEmail: email, source: "apple", status: "revoked", currentPeriodEnd: Date.now() + 25 * DAY });
    await seedBillingRow({ userEmail: email, source: "stripe", status: "active", currentPeriodEnd: Date.now() + 25 * DAY });
    expect((await asPhoneUser(email, "/api/dashboard")).status).toBe(200);
  });

  it("both sources dead leaves the gate shut", async () => {
    const email = phone("204");
    await seedBillingRow({ userEmail: email, source: "apple", status: "expired", currentPeriodEnd: Date.now() - 10 * DAY });
    await seedBillingRow({ userEmail: email, source: "stripe", status: "canceled", currentPeriodEnd: Date.now() - 10 * DAY });
    expect((await asPhoneUser(email, "/api/dashboard")).status).toBe(402);
  });
});
