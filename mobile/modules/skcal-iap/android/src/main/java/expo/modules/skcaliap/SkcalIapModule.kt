package expo.modules.skcaliap

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android no-op stub.
//
// skcal only sells the subscription through StoreKit on iOS. Google Play Billing
// is not wired up and there is no Android build in any store today. The stub
// exists so the same JS imports resolve and the app still builds and runs on
// Android: isSupported() returns false, which makes the paywall fall back to the
// "text the skcal number" copy, and nothing else is ever called.
class SkcalIapModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SkcalIap")

    // Declared so JS can attach a listener without an emitter warning; the event
    // is never fired on Android.
    Events("onTransactionUpdate")

    Function("isSupported") {
      false
    }

    AsyncFunction("getProducts") { _: List<String> ->
      emptyList<Map<String, Any>>()
    }

    AsyncFunction("purchase") { _: String, _: String? ->
      mapOf("state" to "unsupported")
    }

    AsyncFunction("getEntitlements") {
      emptyList<Map<String, Any>>()
    }

    AsyncFunction("getUnfinished") {
      emptyList<Map<String, Any>>()
    }

    AsyncFunction("sync") {
      // nothing to sync without a billing client
    }

    AsyncFunction("finishTransaction") { _: String ->
      false
    }
  }
}
