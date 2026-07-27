import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Linking, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "./theme";
import { isIapAvailable } from "../modules/skcal-iap";
import { buySubscription, checkIapReadiness, restoreSubscription, type IapReadiness } from "./iap";

// Shown instead of the dashboard when the API answers 402.
//
// This replaces a bare "subscription required" string that left the user with no
// way forward, which is a plausible App Review rejection on its own. Two modes:
//
//   * StoreKit has the product and the worker can verify it  ->  buy button
//   * anything else (today's reality, and Android)           ->  iMessage copy
//
// The fallback deliberately shows no price and no purchase link of any kind.
// Guideline 3.1.1 forbids steering to an outside payment method from inside the
// app, so it says how to get set up and nothing about money.

const SKCAL_NUMBER = "+1 (628) 316-6355";
const SKCAL_SMS = "sms:+16283166355&body=hi";
const TERMS_URL = "https://skcal.fit/terms";
const PRIVACY_URL = "https://skcal.fit/privacy";

type Note = { tone: "info" | "bad"; text: string } | null;

export function Paywall({ onActivated }: { onActivated: () => void }) {
  const insets = useSafeAreaInsets();
  const [readiness, setReadiness] = useState<IapReadiness | null>(null);
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    let live = true;
    checkIapReadiness().then((r) => {
      if (live) setReadiness(r);
    });
    return () => {
      live = false;
    };
  }, []);

  const handle = useCallback(
    async (kind: "buy" | "restore") => {
      setBusy(kind);
      setNote(null);
      try {
        const result = kind === "buy" ? await buySubscription() : await restoreSubscription();
        if (result.outcome === "active") {
          onActivated();
          return;
        }
        if (result.outcome === "cancelled") return;
        if (result.outcome === "pending") {
          setNote({ tone: "info", text: "Waiting on approval from the App Store. This unlocks as soon as it clears." });
          return;
        }
        if (result.outcome === "inactive") {
          setNote({
            tone: "bad",
            text:
              kind === "restore"
                ? "No active subscription found on this Apple ID."
                : "The App Store did not report an active subscription.",
          });
          return;
        }
        setNote({ tone: "bad", text: result.message });
      } finally {
        setBusy(null);
      }
    },
    [onActivated],
  );

  const ready = readiness?.ready === true ? readiness : null;
  // The restore affordance stays available whenever StoreKit itself works, even
  // with no product on sale, because a returning subscriber needs it most in
  // exactly the state where the buy button is hidden.
  const canRestore = isIapAvailable();

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingBottom: 40 + insets.bottom }]}
    >
      <View style={s.card}>
        <Text style={s.cardLabel}>SUBSCRIPTION</Text>
        <Text style={s.heading}>Your account is not active</Text>

        {readiness === null ? (
          <View style={s.loadingRow}>
            <ActivityIndicator color={C.amber} />
            <Text style={s.muted}>checking the App Store</Text>
          </View>
        ) : ready ? (
          <>
            <Text style={s.body}>
              skcal keeps your weight trend, meals, and workouts in one place, and the agent texts you through the
              day. Subscribe to turn it back on.
            </Text>

            <View style={s.planRow}>
              <Text style={s.planName}>{ready.product.displayName}</Text>
              <Text style={s.planPrice}>{ready.product.displayPrice} / month</Text>
            </View>

            <Pressable
              style={[s.cta, busy != null && s.ctaBusy]}
              disabled={busy != null}
              accessibilityRole="button"
              accessibilityLabel="Subscribe"
              onPress={() => handle("buy")}
            >
              <Text style={s.ctaText}>{busy === "buy" ? "OPENING THE APP STORE…" : "SUBSCRIBE"}</Text>
            </Pressable>

            <Text style={s.fine}>
              Payment is charged to your Apple ID when you confirm. It renews every month unless you turn off auto
              renew at least 24 hours before the period ends. Manage or cancel it any time in your Apple ID settings.
            </Text>
            <View style={s.linkRow}>
              <Pressable onPress={() => Linking.openURL(TERMS_URL)} accessibilityRole="link">
                <Text style={s.link}>Terms of Use</Text>
              </Pressable>
              <Text style={s.linkDot}>·</Text>
              <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
                <Text style={s.link}>Privacy Policy</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={s.body}>
              skcal runs over iMessage. Text the skcal number and we will get you set up, then everything you log
              shows up here.
            </Text>
            <Pressable
              style={s.numberBtn}
              accessibilityRole="button"
              accessibilityLabel={`Text skcal at ${SKCAL_NUMBER}`}
              onPress={() => Linking.openURL(SKCAL_SMS).catch(() => {})}
            >
              <Text style={s.numberText}>{SKCAL_NUMBER}</Text>
            </Pressable>
            <Text style={s.fine}>
              Already texting with skcal? Pull down on Today once your account is set up and it will load.
            </Text>
          </>
        )}

        {note && <Text style={[s.note, note.tone === "bad" && s.noteBad]}>{note.text}</Text>}
      </View>

      {canRestore && (
        <Pressable
          style={s.restore}
          disabled={busy != null}
          accessibilityRole="button"
          accessibilityLabel="Restore purchases"
          onPress={() => handle("restore")}
        >
          <Text style={s.restoreText}>{busy === "restore" ? "RESTORING…" : "RESTORE PURCHASES"}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 14 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16 },
  cardLabel: { color: C.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 10 },
  heading: { color: C.fg, fontSize: 23, fontWeight: "800", marginBottom: 8 },
  body: { color: C.muted, fontSize: 14.5, lineHeight: 21 },
  muted: { color: C.muted, fontSize: 13 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  planRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "baseline",
    marginTop: 16, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line,
  },
  planName: { color: C.fg, fontSize: 15, fontWeight: "600" },
  planPrice: { color: C.amber, fontSize: 15, fontFamily: "monospace" },
  cta: {
    marginTop: 14, borderRadius: 999, backgroundColor: C.amber,
    paddingVertical: 13, alignItems: "center",
  },
  ctaBusy: { opacity: 0.6 },
  ctaText: { color: C.amberInk, fontSize: 12.5, fontFamily: "monospace", letterSpacing: 1.4, fontWeight: "700" },
  fine: { color: C.dim, fontSize: 11.5, lineHeight: 16.5, marginTop: 12 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  link: { color: C.info, fontSize: 12, textDecorationLine: "underline" },
  linkDot: { color: C.dim, fontSize: 12 },
  numberBtn: {
    marginTop: 16, borderRadius: 999, borderWidth: 1, borderColor: C.amber,
    paddingVertical: 12, alignItems: "center",
  },
  numberText: { color: C.amber, fontSize: 15, fontFamily: "monospace", letterSpacing: 0.8 },
  note: { color: C.info, fontSize: 13, lineHeight: 18.5, marginTop: 14 },
  noteBad: { color: C.attention },
  restore: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 14 },
  restoreText: { color: C.muted, fontSize: 11, fontFamily: "monospace", letterSpacing: 1.2 },
});
