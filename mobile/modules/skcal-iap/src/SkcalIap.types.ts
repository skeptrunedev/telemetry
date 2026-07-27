// Shapes the native side (ios/SkcalIapModule.swift) encodes. Keep them in sync
// with the two `encode(...)` helpers over there.

/** An auto-renewable subscription as StoreKit reports it. */
export type SkcalProduct = {
  id: string;
  displayName: string;
  description: string;
  /** Already localized and currency-formatted by StoreKit, e.g. "$99.99". */
  displayPrice: string;
  price: number;
  currencyCode: string;
  subscriptionGroupId?: string;
  periodValue?: number;
  periodUnit?: "day" | "week" | "month" | "year" | "unknown";
};

/**
 * How a transaction reached us.
 * - success      the purchase sheet completed
 * - cancelled    the user dismissed the sheet
 * - pending      Ask-to-Buy or SCA, the result arrives on onTransactionUpdate
 * - entitled     from Transaction.currentEntitlements (restore)
 * - unfinished   from Transaction.unfinished (boot-time reconciliation)
 * - updated      from the Transaction.updates stream (renewal, refund, revoke)
 * - unverified   StoreKit could not verify the signature, never an entitlement
 * - unsupported  Android stub
 * - unknown      a StoreKit result case that did not exist when this was written
 */
export type SkcalTransactionState =
  | "success"
  | "cancelled"
  | "pending"
  | "entitled"
  | "unfinished"
  | "updated"
  | "unverified"
  | "unsupported"
  | "unknown";

export type SkcalTransaction = {
  state: SkcalTransactionState;
  /** Absent for cancelled / pending / unsupported results. */
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  /** Epoch milliseconds. */
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  isUpgraded?: boolean;
  appAccountToken?: string;
  /** "Production" | "Sandbox" | "Xcode", iOS 16+ only. */
  environment?: string;
  /**
   * The JWS signed transaction. Passed to the server for completeness, but the
   * Worker never trusts it: it re-fetches the transaction from Apple by id.
   */
  jws?: string;
  /** Only set when state is "unverified". */
  error?: string;
};

export type SkcalIapModuleEvents = {
  onTransactionUpdate: (transaction: SkcalTransaction) => void;
};
