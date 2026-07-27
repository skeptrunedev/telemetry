import { NativeModule, registerWebModule } from "expo";

import type { SkcalIapModuleEvents, SkcalProduct, SkcalTransaction } from "./SkcalIap.types";

// There is no StoreKit on the web, so every call answers "unsupported". This
// keeps the Expo-web preview of the app runnable; the paywall reads
// isSupported() and shows the iMessage fallback copy instead of a buy button.
class SkcalIapModule extends NativeModule<SkcalIapModuleEvents> {
  isSupported(): boolean {
    return false;
  }
  async getProducts(_productIds: string[]): Promise<SkcalProduct[]> {
    return [];
  }
  async purchase(_productId: string, _appAccountToken: string | null): Promise<SkcalTransaction> {
    return { state: "unsupported" };
  }
  async getEntitlements(): Promise<SkcalTransaction[]> {
    return [];
  }
  async getUnfinished(): Promise<SkcalTransaction[]> {
    return [];
  }
  async sync(): Promise<void> {
    /* nothing to sync */
  }
  async finishTransaction(_transactionId: string): Promise<boolean> {
    return false;
  }
}

export default registerWebModule(SkcalIapModule, "SkcalIapModule");
