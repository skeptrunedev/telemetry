// Bridge between the StoreKit module (modules/skcal-iap) and the worker.
//
// Division of labour: StoreKit runs the purchase, the worker decides whether it
// counts. Nothing here treats a StoreKit result as an entitlement; every path
// ends in POST /api/apple/verify, and a transaction is only finished once the
// worker has answered.
//
// The whole file is written for the current reality, which is that in-app
// purchase is UNAVAILABLE: the Paid Applications Agreement is unsigned, no
// product exists in App Store Connect, and the worker has no In-App Purchase
// key. Every entry point therefore has a defined answer for "IAP is off" and
// never throws its way out of a render.

import { appleConfig, appleVerify } from "./api";
import {
  SKCAL_MONTHLY_PRODUCT_ID,
  addTransactionListener,
  finishTransaction,
  getSubscriptionProduct,
  getUnfinishedTransactions,
  isIapAvailable,
  purchaseSubscription,
  restorePurchases,
  type SkcalProduct,
  type SkcalTransaction,
} from "../modules/skcal-iap";

export type { SkcalProduct };

/** Why the paywall can or cannot sell right now. */
export type IapReadiness =
  /** StoreKit has the product and the worker can verify it. */
  | { ready: true; product: SkcalProduct; appAccountToken: string }
  /** Android, web, Expo Go, or payments disabled on the device. */
  | { ready: false; reason: "no-storekit" }
  /** The worker has no In-App Purchase key yet. */
  | { ready: false; reason: "server-not-configured" }
  /** StoreKit works but the product is not live in App Store Connect. */
  | { ready: false; reason: "no-product" }
  /** Could not reach the worker to ask. */
  | { ready: false; reason: "offline" };

/**
 * Everything the paywall needs to decide what to render. Never throws; an
 * unreachable worker degrades to "offline", which shows the same fallback copy
 * as an unconfigured one.
 */
export async function checkIapReadiness(): Promise<IapReadiness> {
  if (!isIapAvailable()) return { ready: false, reason: "no-storekit" };

  let config;
  try {
    config = await appleConfig();
  } catch {
    return { ready: false, reason: "offline" };
  }
  if (!config.configured) return { ready: false, reason: "server-not-configured" };

  const productId = config.productIds[0] ?? SKCAL_MONTHLY_PRODUCT_ID;
  const product = await getSubscriptionProduct(productId);
  if (!product) return { ready: false, reason: "no-product" };
  return { ready: true, product, appAccountToken: config.appAccountToken };
}

export type PurchaseOutcome =
  | { outcome: "active" }
  /** Verified, but Apple says it is expired or refunded. */
  | { outcome: "inactive"; status: string }
  | { outcome: "cancelled" }
  /** Ask-to-Buy or SCA. The result lands later on the transaction listener. */
  | { outcome: "pending" }
  | { outcome: "error"; message: string };

/**
 * Verify one transaction with the worker and, if the worker accepted it, finish
 * it with StoreKit. Finishing is what stops Apple redelivering it forever, so it
 * happens for a verified refund too, not just a verified grant.
 */
async function verifyAndFinish(transaction: SkcalTransaction): Promise<PurchaseOutcome> {
  if (!transaction.transactionId) return { outcome: "error", message: "StoreKit returned no transaction id" };
  try {
    const result = await appleVerify(transaction.transactionId);
    await finishTransaction(transaction.transactionId);
    return result.active ? { outcome: "active" } : { outcome: "inactive", status: result.status };
  } catch (e) {
    // Leave the transaction unfinished so the next launch retries it.
    return { outcome: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Run the full buy flow. Safe to call even when IAP is unavailable. */
export async function buySubscription(): Promise<PurchaseOutcome> {
  const readiness = await checkIapReadiness();
  if (!readiness.ready) {
    // Name the failing step. The four reasons need different fixes (device vs
    // worker secrets vs App Store product propagation), and a generic message
    // makes them indistinguishable from the outside.
    const why: Record<string, string> = {
      "no-storekit": "StoreKit is unavailable on this device",
      offline: "could not reach skcal",
      "server-not-configured": "skcal is missing its App Store keys",
      "no-product": "the App Store has not published the subscription yet",
    };
    return { outcome: "error", message: `Subscribing is not available yet, ${why[readiness.reason] ?? readiness.reason}` };
  }

  let transaction: SkcalTransaction;
  try {
    transaction = await purchaseSubscription(readiness.product.id, readiness.appAccountToken);
  } catch (e) {
    return { outcome: "error", message: e instanceof Error ? e.message : String(e) };
  }

  if (transaction.state === "cancelled") return { outcome: "cancelled" };
  if (transaction.state === "pending") return { outcome: "pending" };
  if (transaction.state !== "success") {
    return { outcome: "error", message: "The App Store did not complete this purchase" };
  }
  return verifyAndFinish(transaction);
}

/**
 * Restore purchases. Runs AppStore.sync() first because this is always
 * user-initiated, then re-verifies every entitlement against the worker.
 */
export async function restoreSubscription(): Promise<PurchaseOutcome> {
  if (!isIapAvailable()) return { outcome: "error", message: "The App Store is not available on this device" };
  const entitlements = await restorePurchases(true);
  if (entitlements.length === 0) return { outcome: "inactive", status: "none" };

  let last: PurchaseOutcome = { outcome: "inactive", status: "none" };
  for (const entitlement of entitlements) {
    const result = await verifyAndFinish(entitlement);
    if (result.outcome === "active") return result;
    last = result;
  }
  return last;
}

/**
 * Re-verify anything StoreKit still considers unfinished. Covers the purchase
 * that succeeded while the verify call was failing, plus Ask-to-Buy approvals
 * that landed while the app was closed. Returns true if access was granted.
 */
export async function reconcilePendingTransactions(): Promise<boolean> {
  const pending = await getUnfinishedTransactions();
  let granted = false;
  for (const transaction of pending) {
    const result = await verifyAndFinish(transaction);
    if (result.outcome === "active") granted = true;
  }
  return granted;
}

/**
 * Watch Transaction.updates so a renewal, refund, or revocation that happens
 * while the app is open pokes the worker immediately instead of waiting for the
 * next App Store Server Notification round trip. `onChange` fires after the
 * worker has been told, so the caller can refetch.
 */
export function watchTransactions(onChange: (outcome: PurchaseOutcome) => void): () => void {
  const subscription = addTransactionListener((transaction) => {
    // "unverified" means StoreKit itself could not check the signature; there is
    // nothing to send the worker.
    if (transaction.state === "unverified" || !transaction.transactionId) return;
    void verifyAndFinish(transaction).then(onChange);
  });
  return () => subscription.remove();
}
