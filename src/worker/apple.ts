// Apple in-app purchase support: App Store Server API client + the pure logic
// that turns Apple's answers into a `billing` row.
//
// This module is the replacement for a RevenueCat-style middleman. The rule it
// enforces everywhere is "notification as trigger, API as truth": nothing the
// client or Apple's webhook body claims is ever written to `billing`. We take an
// identifier out of the request, re-fetch the authoritative record from Apple's
// App Store Server API with a JWT we sign ourselves, and write only what came
// back over that connection.
//
// Deliberate non-goal: we do NOT validate the x5c certificate chain on Apple's
// signed payloads. Doing that correctly inside a Worker means shipping Apple's
// root CAs and hand-rolling chain verification on WebCrypto, which is a lot of
// security-critical code to own. Re-fetching from Apple sidesteps it entirely,
// at the cost of one outbound request per notification. See the notes on
// `decodeJwsPayload` for what that means for callers.
//
// Everything above `signAppleJwt` is pure and unit-tested in test/apple.test.ts.

// ---- config -----------------------------------------------------------------

export const APPLE_BUNDLE_ID = "fit.skcal.app";

/** Product ids we will honour. An unknown product id never grants access. */
export const APPLE_PRODUCT_IDS: readonly string[] = ["fit.skcal.app.monthly"];

export const APPLE_API_PRODUCTION = "https://api.storekit.itunes.apple.com/inApps/v1";
export const APPLE_API_SANDBOX = "https://api.storekit-sandbox.itunes.apple.com/inApps/v1";

/** Apple caps App Store Server API tokens at 60 minutes; stay well inside it. */
const TOKEN_TTL_SEC = 20 * 60;

export type AppleIapEnv = {
  APPLE_IAP_KEY_ID?: string;
  APPLE_IAP_ISSUER_ID?: string;
  APPLE_IAP_PRIVATE_KEY?: string;
};

/**
 * True once all three In-App Purchase key secrets are set. They do not exist
 * yet (the Paid Applications Agreement is unsigned), so the routes that need
 * them answer with a clear "not configured" error rather than half-failing.
 */
export function appleIapConfigured(env: AppleIapEnv): boolean {
  return !!(env.APPLE_IAP_KEY_ID && env.APPLE_IAP_ISSUER_ID && env.APPLE_IAP_PRIVATE_KEY);
}

// ---- base64url --------------------------------------------------------------

/** Decodes base64url and plain base64 alike (the `-`/`_` swap is a no-op on plain). */
function b64uToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uJson(value: unknown): string {
  return bytesToB64u(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Read the payload out of a JWS **without checking its signature**.
 *
 * Only ever safe because of how callers use it: the decoded value is treated as
 * an untrusted lookup key (a transaction id) that is immediately re-fetched
 * from Apple over TLS. Never pass the result of this straight into `billing`.
 */
export function decodeJwsPayload<T>(jws: string): T {
  const parts = jws.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("malformed JWS");
  const json = new TextDecoder().decode(b64uToBytes(parts[1]));
  return JSON.parse(json) as T;
}

// ---- JWT (ES256, App Store Server API) --------------------------------------

export type AppleJwtParts = {
  header: { alg: "ES256"; kid: string; typ: "JWT" };
  payload: { iss: string; iat: number; exp: number; aud: "appstoreconnect-v1"; bid: string };
};

/**
 * The exact header + payload Apple expects for an App Store Server API token.
 * Split out from signing so it can be asserted without a private key.
 */
export function appleJwtParts(
  keyId: string,
  issuerId: string,
  nowMs: number,
  bundleId: string = APPLE_BUNDLE_ID,
): AppleJwtParts {
  const iat = Math.floor(nowMs / 1000);
  return {
    header: { alg: "ES256", kid: keyId, typ: "JWT" },
    payload: { iss: issuerId, iat, exp: iat + TOKEN_TTL_SEC, aud: "appstoreconnect-v1", bid: bundleId },
  };
}

/** The signing input, i.e. everything before the signature. */
export function appleJwtSigningInput(parts: AppleJwtParts): string {
  return `${b64uJson(parts.header)}.${b64uJson(parts.payload)}`;
}

/**
 * Import Apple's downloaded `.p8` (PKCS#8, prime256v1) as an ECDSA signing key.
 * The secret may be stored with real newlines or with literal `\n`, since both
 * survive `wrangler secret put` differently depending on the shell.
 */
async function importP8(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("empty private key");
  const der = b64uToBytes(body);
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/**
 * Mint a bearer token for the App Store Server API. WebCrypto's ECDSA output is
 * already the raw r‖s pair JWS ES256 wants, so no DER unwrapping is needed.
 */
export async function signAppleJwt(env: AppleIapEnv, nowMs: number = Date.now()): Promise<string> {
  if (!appleIapConfigured(env)) throw new Error("apple iap not configured");
  const parts = appleJwtParts(env.APPLE_IAP_KEY_ID!, env.APPLE_IAP_ISSUER_ID!, nowMs);
  const input = appleJwtSigningInput(parts);
  const key = await importP8(env.APPLE_IAP_PRIVATE_KEY!);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${bytesToB64u(new Uint8Array(sig))}`;
}

// ---- App Store Server API ---------------------------------------------------

/** Decoded `signedTransactionInfo`. Dates are epoch milliseconds. */
export type AppleTransactionInfo = {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  purchaseDate?: number;
  originalPurchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  type?: string;
  inAppOwnershipType?: string;
  environment?: string;
  offerType?: number;
  offerDiscountType?: string;
  webOrderLineItemId?: string;
  /** The UUID the app passed to StoreKit at purchase time; our account binding. */
  appAccountToken?: string;
};

export type AppleNotificationPayload = {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  version?: string;
  signedDate?: number;
  data?: {
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
};

type AppleFetch = { ok: true; body: unknown; sandbox: boolean } | { ok: false; status: number; detail: string };

/**
 * GET an App Store Server API path, production first then sandbox.
 *
 * Apple runs two completely separate environments and gives no way to tell
 * which one a transaction id belongs to, so the documented approach is to try
 * production and fall back to sandbox on a not-found. TestFlight and Xcode
 * purchases only ever exist in sandbox.
 */
async function appleGet(env: AppleIapEnv, path: string): Promise<AppleFetch> {
  const token = await signAppleJwt(env);
  let last: { status: number; detail: string } = { status: 0, detail: "no response" };
  for (const [base, sandbox] of [
    [APPLE_API_PRODUCTION, false],
    [APPLE_API_SANDBOX, true],
  ] as const) {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    } catch (e) {
      last = { status: 0, detail: String(e) };
      continue;
    }
    const text = await res.text();
    if (res.ok) {
      try {
        return { ok: true, body: JSON.parse(text), sandbox };
      } catch {
        return { ok: false, status: 502, detail: "apple returned non-JSON" };
      }
    }
    last = { status: res.status, detail: text.slice(0, 300) };
    // Only a not-found is worth retrying in the other environment; a 401 means
    // our key is wrong and a 429 means we should back off, in both environments.
    if (res.status !== 404) break;
  }
  return { ok: false, ...last };
}

/** GET /inApps/v1/transactions/{transactionId} */
export async function appleGetTransaction(
  env: AppleIapEnv,
  transactionId: string,
): Promise<{ ok: true; info: AppleTransactionInfo; sandbox: boolean } | { ok: false; status: number; detail: string }> {
  const res = await appleGet(env, `/transactions/${encodeURIComponent(transactionId)}`);
  if (!res.ok) return res;
  const signed = (res.body as { signedTransactionInfo?: string }).signedTransactionInfo;
  if (!signed) return { ok: false, status: 502, detail: "apple response had no signedTransactionInfo" };
  try {
    // Decoding without chain validation is safe here: this JWS came from Apple
    // over TLS on a request we authenticated with our own key.
    return { ok: true, info: decodeJwsPayload<AppleTransactionInfo>(signed), sandbox: res.sandbox };
  } catch {
    return { ok: false, status: 502, detail: "could not decode signedTransactionInfo" };
  }
}

/**
 * GET /inApps/v1/subscriptions/{originalTransactionId} — the authoritative
 * current state of a subscription, including Apple's own status code.
 */
export async function appleGetSubscriptionState(
  env: AppleIapEnv,
  originalTransactionId: string,
): Promise<
  | { ok: true; info: AppleTransactionInfo; statusCode: number; sandbox: boolean }
  | { ok: false; status: number; detail: string }
> {
  const res = await appleGet(env, `/subscriptions/${encodeURIComponent(originalTransactionId)}`);
  if (!res.ok) return res;
  const body = res.body as {
    data?: { lastTransactions?: { status?: number; signedTransactionInfo?: string }[] }[];
  };
  for (const group of body.data ?? []) {
    for (const last of group.lastTransactions ?? []) {
      if (!last.signedTransactionInfo) continue;
      let info: AppleTransactionInfo;
      try {
        info = decodeJwsPayload<AppleTransactionInfo>(last.signedTransactionInfo);
      } catch {
        continue;
      }
      if (info.originalTransactionId !== originalTransactionId) continue;
      return { ok: true, info, statusCode: last.status ?? 0, sandbox: res.sandbox };
    }
  }
  return { ok: false, status: 404, detail: "no matching subscription in apple's response" };
}

// ---- notification / transaction → billing state -----------------------------

export type BillingStatus =
  | "active"
  | "trialing"
  | "grace_period"
  | "billing_retry"
  | "expired"
  | "revoked"
  | "canceled";

/** Apple's `status` field on a subscription's last transaction. */
export function appleStatusCodeToBilling(code: number): BillingStatus {
  switch (code) {
    case 1:
      return "active";
    case 2:
      return "expired";
    case 3:
      return "billing_retry";
    case 4:
      return "grace_period";
    case 5:
      return "revoked";
    default:
      // Unknown code: fail closed. The row simply does not grant access.
      return "expired";
  }
}

function isTrial(info: AppleTransactionInfo): boolean {
  return info.offerDiscountType === "FREE_TRIAL" || info.offerType === 1;
}

/**
 * Turn an authoritative transaction (always one we re-fetched from Apple) into
 * the `billing` row we store.
 *
 * `statusCode` is Apple's own subscription status and wins whenever we have it.
 * `notificationType`/`subtype` only ever narrow the result, they never invent an
 * entitlement, so a forged webhook body cannot upgrade anyone.
 *
 * Worth calling out: DID_CHANGE_RENEWAL_STATUS (the user switched auto-renew
 * off) deliberately does NOT revoke. The subscription is paid through
 * `expiresDate` and access must last that long.
 */
export function appleBillingState(
  info: AppleTransactionInfo,
  opts: { statusCode?: number; notificationType?: string; subtype?: string; now?: number } = {},
): { status: BillingStatus; currentPeriodEnd: number | null } {
  const now = opts.now ?? Date.now();
  const currentPeriodEnd = typeof info.expiresDate === "number" ? info.expiresDate : null;

  // Money went back to the customer: nothing else matters.
  if (typeof info.revocationDate === "number") return { status: "revoked", currentPeriodEnd };
  if (opts.notificationType === "REFUND" || opts.notificationType === "REVOKE") {
    return { status: "revoked", currentPeriodEnd };
  }

  if (typeof opts.statusCode === "number" && opts.statusCode > 0) {
    const mapped = appleStatusCodeToBilling(opts.statusCode);
    return { status: mapped === "active" && isTrial(info) ? "trialing" : mapped, currentPeriodEnd };
  }

  // No status code (the single-transaction lookup): read the notification type
  // if there is one, otherwise fall back to the dates on the transaction.
  switch (opts.notificationType) {
    case "EXPIRED":
    case "GRACE_PERIOD_EXPIRED":
      return { status: "expired", currentPeriodEnd };
    case "DID_FAIL_TO_RENEW":
      return {
        status: opts.subtype === "GRACE_PERIOD" ? "grace_period" : "billing_retry",
        currentPeriodEnd,
      };
    default:
      break;
  }
  if (currentPeriodEnd != null && currentPeriodEnd <= now) return { status: "expired", currentPeriodEnd };
  return { status: isTrial(info) ? "trialing" : "active", currentPeriodEnd };
}

// ---- entitlement ------------------------------------------------------------

const DAY_MS = 86_400_000;
/** Webhook lag on a renewal shouldn't lock anyone out mid-workout. */
const RENEWAL_SLOP_MS = 3 * DAY_MS;

export type BillingRowLike = {
  status?: string | null;
  currentPeriodEnd?: Date | number | null;
};

/** Does this single (account, store) row currently grant access? */
export function billingRowActive(row: BillingRowLike | undefined | null, now: number = Date.now()): boolean {
  if (!row?.status) return false;
  const raw = row.currentPeriodEnd;
  const end = raw == null ? null : raw instanceof Date ? raw.getTime() : raw;
  const withinSlop = end == null || end > now - RENEWAL_SLOP_MS;
  switch (row.status) {
    case "active":
    case "trialing":
      return withinSlop;
    // Stripe dunning: Stripe is retrying the card, keep access.
    case "past_due":
    // Apple billing grace period: Apple explicitly asks that access continue.
    case "grace_period":
      return true;
    // Apple is retrying after the period already lapsed. Mirror the Stripe
    // dunning courtesy but bound it, so a permanently failing card ends.
    case "billing_retry":
      return withinSlop;
    default:
      // canceled / expired / revoked / unpaid / incomplete
      return false;
  }
}

/**
 * Source-aware entitlement: any store saying yes is a yes. Without this an
 * expired Stripe row would cancel out a live Apple one purely because it was
 * written more recently.
 */
export function anyBillingRowActive(rows: BillingRowLike[], now: number = Date.now()): boolean {
  return rows.some((row) => billingRowActive(row, now));
}
