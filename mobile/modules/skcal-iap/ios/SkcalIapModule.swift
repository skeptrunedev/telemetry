import ExpoModulesCore
import StoreKit

// StoreKit 2 wrapped as a local Expo module.
//
// Why hand-rolled: every third-party RN IAP package we looked at is deprecated
// or archived, and RevenueCat is out of scope because the skcal Worker plus its
// D1 `billing` table are the entitlement store. So this file is deliberately
// thin: it fetches products, runs a purchase, and hands JS the JWS signed
// transaction plus the transaction id. It never decides whether a user is
// entitled, the Worker re-fetches the transaction from Apple's App Store Server
// API and writes `billing`. Client payloads are a hint, never a grant.
//
// Lifecycle contract with JS:
//   1. purchase() / getEntitlements() / getUnfinished() return `jws` + ids.
//   2. JS POSTs the transaction id to /api/apple/verify.
//   3. Only after the Worker confirms does JS call finishTransaction(id).
// Finishing before the server grants would lose the transaction on a crash, so
// nothing in here calls finish() on its own.
//
// The podspec pins iOS 16.4, well above StoreKit 2's iOS 15 floor, so the
// StoreKit 2 surface is used unguarded. Anything newer than 16.4 (currently just
// Transaction.environment) sits behind an availability check.

// ExpoModulesCore pulls in SwiftUI, which has its own `Transaction`, so the
// bare name is ambiguous in this file. Alias StoreKit's once and use that.
private typealias StoreTransaction = StoreKit.Transaction

// ---- errors -----------------------------------------------------------------
// Every failure path is a typed exception so JS gets a clean, catchable message
// instead of an unhandled Swift throw. A product that does not exist yet in App
// Store Connect lands on ProductNotFoundException, which is the state skcal is
// in until the Paid Applications Agreement is signed.

internal final class IapUnavailableException: Exception, @unchecked Sendable {
  override var reason: String {
    "In-app purchases are not available on this device"
  }
}

internal final class ProductNotFoundException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "No App Store product with id '\(param)'"
  }
}

internal final class StoreKitRequestException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Could not reach the App Store: \(param)"
  }
}

internal final class PurchaseFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Purchase failed: \(param)"
  }
}

internal final class VerificationFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "The App Store could not verify this transaction: \(param)"
  }
}

// ---- module -----------------------------------------------------------------

public class SkcalIapModule: Module {
  private var updatesTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("SkcalIap")

    Events("onTransactionUpdate")

    // Apple requires a Transaction.updates listener to be running for the whole
    // app lifetime so renewals, Ask-to-Buy approvals, and purchases that were
    // interrupted (app killed mid-flow) are still delivered. Starting it at
    // module creation rather than on JS subscription means nothing is dropped
    // while the JS bundle boots; getUnfinished() below covers anything that
    // arrived before JS attached a listener.
    OnCreate {
      self.startUpdatesListener()
    }

    OnDestroy {
      self.updatesTask?.cancel()
      self.updatesTask = nil
    }

    // False on a device where payments are disabled (parental controls, MDM).
    Function("isSupported") { () -> Bool in
      AppStore.canMakePayments
    }

    // Missing / not-yet-approved product ids simply do not come back in the
    // array. That is the normal answer today, so it is not an error here; the
    // caller decides (purchase() does raise for an unknown id).
    AsyncFunction("getProducts") { (productIds: [String]) async throws -> [[String: Any]] in
      if productIds.isEmpty {
        return []
      }
      do {
        let products = try await Product.products(for: productIds)
        return products.map { Self.encodeProduct($0) }
      } catch {
        throw StoreKitRequestException(error.localizedDescription)
      }
    }

    // Runs the StoreKit purchase sheet. Resolves with one of:
    //   { state: "success", jws, transactionId, originalTransactionId, ... }
    //   { state: "cancelled" }   user dismissed the sheet
    //   { state: "pending" }     Ask-to-Buy / SCA, the real result arrives on
    //                            the onTransactionUpdate event later
    // `appAccountToken` is the UUID the Worker derives from the signed-in
    // account. Apple echoes it back on every transaction for this subscription,
    // which is how the server proves a transaction belongs to the account
    // claiming it (transaction ids are sequential, so they are guessable).
    AsyncFunction("purchase") { (productId: String, appAccountToken: String?) async throws -> [String: Any] in
      guard AppStore.canMakePayments else {
        throw IapUnavailableException()
      }
      let products: [Product]
      do {
        products = try await Product.products(for: [productId])
      } catch {
        throw StoreKitRequestException(error.localizedDescription)
      }
      guard let product = products.first else {
        throw ProductNotFoundException(productId)
      }

      var options: Set<Product.PurchaseOption> = []
      if let appAccountToken, let uuid = UUID(uuidString: appAccountToken) {
        options.insert(.appAccountToken(uuid))
      }

      let result: Product.PurchaseResult
      do {
        result = try await product.purchase(options: options)
      } catch {
        throw PurchaseFailedException(error.localizedDescription)
      }

      switch result {
      case .success(let verification):
        let transaction = try Self.verified(verification)
        return Self.encodeTransaction(transaction, jws: verification.jwsRepresentation, state: "success")
      case .userCancelled:
        return ["state": "cancelled"]
      case .pending:
        return ["state": "pending"]
      @unknown default:
        return ["state": "unknown"]
      }
    }

    // Restore: the current entitlement for every product this Apple ID owns.
    // StoreKit 2 keeps this in sync with the store, so no receipt refresh is
    // needed for the common case; sync() below is the heavier fallback.
    AsyncFunction("getEntitlements") { () async -> [[String: Any]] in
      var out: [[String: Any]] = []
      for await result in StoreTransaction.currentEntitlements {
        if case .verified(let transaction) = result {
          out.append(Self.encodeTransaction(transaction, jws: result.jwsRepresentation, state: "entitled"))
        }
      }
      return out
    }

    // Transactions StoreKit still considers unfinished, i.e. ones we have not
    // acknowledged yet. Called on app boot so a purchase that completed while
    // the server call was in flight gets re-verified instead of stranded.
    AsyncFunction("getUnfinished") { () async -> [[String: Any]] in
      var out: [[String: Any]] = []
      for await result in StoreTransaction.unfinished {
        if case .verified(let transaction) = result {
          out.append(Self.encodeTransaction(transaction, jws: result.jwsRepresentation, state: "unfinished"))
        }
      }
      return out
    }

    // Forces a StoreKit account refresh, which can prompt for the App Store
    // password. Apple only allows this behind an explicit user action, so JS
    // calls it from the Restore purchases button and nowhere else.
    AsyncFunction("sync") { () async throws in
      do {
        try await AppStore.sync()
      } catch {
        throw StoreKitRequestException(error.localizedDescription)
      }
    }

    // Acknowledge a transaction once the Worker has recorded the entitlement.
    // Unknown / already-finished ids are a no-op rather than an error: a repeat
    // call after a retry must not blow up the caller.
    AsyncFunction("finishTransaction") { (transactionId: String) async -> Bool in
      var finished = false
      for await result in StoreTransaction.unfinished {
        var transaction: StoreTransaction?
        switch result {
        case .verified(let value):
          transaction = value
        case .unverified(let value, _):
          transaction = value
        }
        if let transaction, String(transaction.id) == transactionId {
          await transaction.finish()
          finished = true
        }
      }
      return finished
    }
  }

  // ---- Transaction.updates ---------------------------------------------------
  // Renewals, refunds, revocations, and deferred purchases all surface here.
  // We forward them to JS, which pokes /api/apple/verify; we deliberately do NOT
  // finish them here, because the entitlement is not real until the Worker has
  // re-fetched the transaction from Apple.
  private func startUpdatesListener() {
    updatesTask?.cancel()
    let emit: ([String: Any]) -> Void = { [weak self] payload in
      self?.sendEvent("onTransactionUpdate", payload)
    }
    updatesTask = Task {
      for await result in StoreTransaction.updates {
        switch result {
        case .verified(let transaction):
          emit(Self.encodeTransaction(transaction, jws: result.jwsRepresentation, state: "updated"))
        case .unverified(let transaction, let error):
          // Surfaced so the app can log it, never treated as an entitlement.
          emit([
            "state": "unverified",
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "productId": transaction.productID,
            "error": error.localizedDescription,
          ])
        }
      }
    }
  }

  // ---- encoding --------------------------------------------------------------

  private static func verified<T>(_ result: VerificationResult<T>) throws -> T {
    switch result {
    case .verified(let safe):
      return safe
    case .unverified(_, let error):
      throw VerificationFailedException(error.localizedDescription)
    }
  }

  private static func encodeProduct(_ product: Product) -> [String: Any] {
    var out: [String: Any] = [
      "id": product.id,
      "displayName": product.displayName,
      "description": product.description,
      "displayPrice": product.displayPrice,
      "price": NSDecimalNumber(decimal: product.price).doubleValue,
      "currencyCode": product.priceFormatStyle.currencyCode,
    ]
    if let subscription = product.subscription {
      out["subscriptionGroupId"] = subscription.subscriptionGroupID
      out["periodValue"] = subscription.subscriptionPeriod.value
      out["periodUnit"] = Self.name(for: subscription.subscriptionPeriod.unit)
    }
    return out
  }

  private static func name(for unit: Product.SubscriptionPeriod.Unit) -> String {
    switch unit {
    case .day: return "day"
    case .week: return "week"
    case .month: return "month"
    case .year: return "year"
    @unknown default: return "unknown"
    }
  }

  // `jws` is the signed transaction. It is what the Worker would verify if it
  // did local x5c validation; today the Worker instead treats the id as a lookup
  // key and re-fetches from Apple, so the JWS travels along for logging and for
  // a future offline-verification path.
  private static func encodeTransaction(_ transaction: StoreTransaction, jws: String, state: String) -> [String: Any] {
    var out: [String: Any] = [
      "state": state,
      "transactionId": String(transaction.id),
      "originalTransactionId": String(transaction.originalID),
      "productId": transaction.productID,
      "purchaseDate": transaction.purchaseDate.timeIntervalSince1970 * 1000,
      "isUpgraded": transaction.isUpgraded,
      "jws": jws,
    ]
    if let expirationDate = transaction.expirationDate {
      out["expiresDate"] = expirationDate.timeIntervalSince1970 * 1000
    }
    if let revocationDate = transaction.revocationDate {
      out["revocationDate"] = revocationDate.timeIntervalSince1970 * 1000
    }
    if let appAccountToken = transaction.appAccountToken {
      out["appAccountToken"] = appAccountToken.uuidString
    }
    if #available(iOS 16.0, *) {
      out["environment"] = transaction.environment.rawValue
    }
    return out
  }
}
