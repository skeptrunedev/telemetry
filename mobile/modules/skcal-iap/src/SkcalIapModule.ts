import { NativeModule, requireNativeModule } from "expo";

import type { SkcalIapModuleEvents, SkcalProduct, SkcalTransaction } from "./SkcalIap.types";

declare class SkcalIapModule extends NativeModule<SkcalIapModuleEvents> {
  /** False when the device cannot make payments, and always false on Android. */
  isSupported(): boolean;
  /** Ids that do not exist in App Store Connect are simply absent from the result. */
  getProducts(productIds: string[]): Promise<SkcalProduct[]>;
  purchase(productId: string, appAccountToken: string | null): Promise<SkcalTransaction>;
  getEntitlements(): Promise<SkcalTransaction[]>;
  getUnfinished(): Promise<SkcalTransaction[]>;
  /** AppStore.sync(); may prompt for the App Store password, so user-initiated only. */
  sync(): Promise<void>;
  finishTransaction(transactionId: string): Promise<boolean>;
}

export default requireNativeModule<SkcalIapModule>("SkcalIap");
