// Public JS surface of the skcal StoreKit 2 module.
//
// Everything here degrades to "not available" rather than throwing, because
// that is skcal's normal state right now: the Paid Applications Agreement is
// unsigned and no subscription product exists in App Store Connect yet, so
// StoreKit returns an empty product list. Callers should branch on
// isIapAvailable() / getSubscriptionProduct() returning null, not on catch.
//
// The native module is loaded lazily through require() so that Expo Go, the web
// preview, and any build where autolinking did not pick the module up fall back
// to the unavailable path instead of crashing at import time. Same guard style
// as src/health.ts.

import type { EventSubscription } from "expo-modules-core";

import type {
  SkcalIapModuleEvents,
  SkcalProduct,
  SkcalTransaction,
  SkcalTransactionState,
} from "./src/SkcalIap.types";

export type { SkcalProduct, SkcalTransaction, SkcalTransactionState };

/**
 * The auto-renewable subscription id. Must match the product created in App
 * Store Connect exactly, and the product must be in the same subscription group
 * as any future tiers.
 */
export const SKCAL_MONTHLY_PRODUCT_ID = "fit.skcal.app.monthly";

type NativeIap = {
  isSupported(): boolean;
  getProducts(productIds: string[]): Promise<SkcalProduct[]>;
  purchase(productId: string, appAccountToken: string | null): Promise<SkcalTransaction>;
  getEntitlements(): Promise<SkcalTransaction[]>;
  getUnfinished(): Promise<SkcalTransaction[]>;
  sync(): Promise<void>;
  finishTransaction(transactionId: string): Promise<boolean>;
  addListener<K extends keyof SkcalIapModuleEvents>(
    event: K,
    listener: SkcalIapModuleEvents[K],
  ): EventSubscription;
};

let cached: NativeIap | null | undefined;

function native(): NativeIap | null {
  if (cached === undefined) {
    try {
      cached = (require("./src/SkcalIapModule") as { default: NativeIap }).default ?? null;
    } catch {
      cached = null;
    }
  }
  return cached;
}

/** True when StoreKit is reachable in this build and the device can pay. */
export function isIapAvailable(): boolean {
  const mod = native();
  if (!mod) return false;
  try {
    return mod.isSupported();
  } catch {
    return false;
  }
}

/**
 * The subscription product, or null when StoreKit has nothing to sell. Null is
 * the expected answer until the product is created and approved, so treat it as
 * "show the fallback copy", never as an error.
 */
export async function getSubscriptionProduct(
  productId: string = SKCAL_MONTHLY_PRODUCT_ID,
): Promise<SkcalProduct | null> {
  const mod = native();
  if (!mod || !isIapAvailable()) return null;
  try {
    const products = await mod.getProducts([productId]);
    return products.find((p) => p.id === productId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Run the StoreKit purchase sheet. Rejects only on a real StoreKit failure; a
 * user cancel resolves with state "cancelled" so the caller can stay quiet.
 *
 * `appAccountToken` comes from GET /api/apple/config and binds the resulting
 * transaction to the signed-in account, which is how the Worker later refuses a
 * replayed transaction id.
 */
export async function purchaseSubscription(
  productId: string = SKCAL_MONTHLY_PRODUCT_ID,
  appAccountToken: string | null = null,
): Promise<SkcalTransaction> {
  const mod = native();
  if (!mod || !isIapAvailable()) return { state: "unsupported" };
  return mod.purchase(productId, appAccountToken);
}

/**
 * Everything this Apple ID currently owns. `force` runs AppStore.sync() first,
 * which can prompt for the App Store password, so only pass it from an explicit
 * "Restore purchases" tap.
 */
export async function restorePurchases(force = false): Promise<SkcalTransaction[]> {
  const mod = native();
  if (!mod || !isIapAvailable()) return [];
  if (force) {
    try {
      await mod.sync();
    } catch {
      // A failed sync still leaves currentEntitlements usable; keep going.
    }
  }
  try {
    return await mod.getEntitlements();
  } catch {
    return [];
  }
}

/**
 * Transactions StoreKit has not seen acknowledged yet, e.g. a purchase whose
 * server verification never completed. Re-verify these on app start.
 */
export async function getUnfinishedTransactions(): Promise<SkcalTransaction[]> {
  const mod = native();
  if (!mod || !isIapAvailable()) return [];
  try {
    return await mod.getUnfinished();
  } catch {
    return [];
  }
}

/** Acknowledge a transaction. Call this only after the server granted access. */
export async function finishTransaction(transactionId: string): Promise<boolean> {
  const mod = native();
  if (!mod) return false;
  try {
    return await mod.finishTransaction(transactionId);
  } catch {
    return false;
  }
}

/**
 * Subscribe to Transaction.updates: renewals, refunds, revocations, and
 * purchases that completed outside the app. Returns a no-op subscription when
 * StoreKit is unavailable so callers can unconditionally remove() on unmount.
 */
export function addTransactionListener(
  listener: (transaction: SkcalTransaction) => void,
): EventSubscription {
  const mod = native();
  if (!mod) return { remove: () => {} } as EventSubscription;
  try {
    return mod.addListener("onTransactionUpdate", listener);
  } catch {
    return { remove: () => {} } as EventSubscription;
  }
}
