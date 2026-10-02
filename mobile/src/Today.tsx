import { useCallback, useEffect, useState, type ReactNode } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet, Pressable, Alert, Platform, type DimensionValue, AppState } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme } from "./theme";
import {
  dashboard, Dashboard, kgToLb, cmToIn, listReminders, deleteReminder, setReminderEnabled, Reminder,
  listMeals, Meal, todayLocal,
} from "./api";
import { healthSupported, isHealthConnected, connectAppleHealth, syncAppleHealth } from "./health";
import { XIcon } from "./icons";
import { WeightChart } from "./WeightChart";
import { MealsCard } from "./Meals";
import { MEASUREMENT_SITES, siteLabel } from "./sites";
import { useContentWidth, COMPACT_WIDTH } from "./layout";
import { weeklyDeltaLb, weightInsight } from "./weight";

// "08:00" in the reminder's tz → "8:00 AM CDT · weekdays" style, mirroring the
// web card. Hermes ships Intl, but guard timeZoneName and fall back to the raw
// tz string if the short zone name is unavailable.
function fmtWhen(r: Reminder): string {
  const [h = 0, m = 0] = r.time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  let zone = r.tz;
  try {
    zone =
      new Intl.DateTimeFormat(undefined, { timeZone: r.tz, timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? r.tz;
  } catch {
    // keep the raw tz string
  }
  const days = r.onceDate ? `once, ${r.onceDate}` : r.days;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm} ${zone} · ${days}`;
}

// Reminders the agents set up — manageable here, creation stays conversational.
function RemindersCard({ data, onChanged }: { data: { reminders: Reminder[]; phoneLinked: boolean }; onChanged: () => void }) {
  const s = useS();
  const { c } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (r: Reminder) => {
    setBusy(r.id);
    try {
      await setReminderEnabled(r.id, !r.enabled);
      onChanged();
    } finally {
      setBusy(null);
    }
  };
  const remove = (r: Reminder) =>
    Alert.alert("Delete this reminder?", `“${r.instruction}”`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(r.id);
          try {
            await deleteReminder(r.id);
            onChanged();
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>REMINDERS · TEXTED FROM SKCAL</Text>
      {data.reminders.length === 0 ? (
        <Text style={s.remEmpty}>none yet — ask the agent, “remind me to log lunch at noon”</Text>
      ) : (
        data.reminders.map((r, i) => (
          <View key={r.id} style={[s.remRow, i > 0 && s.remRowBorder]}>
            <View style={s.remTop}>
              <Text style={[s.remText, !r.enabled && s.remOff]}>{r.instruction}</Text>
              <View style={s.remActions}>
                <Pressable
                  style={s.remToggle}
                  disabled={busy === r.id}
                  onPress={() => toggle(r)}
                  accessibilityLabel={r.enabled ? "Pause reminder" : "Resume reminder"}
                >
                  <Text style={s.remToggleText}>{r.enabled ? "ON" : "OFF"}</Text>
                </Pressable>
                <Pressable
                  style={s.remDelete}
                  disabled={busy === r.id}
                  onPress={() => remove(r)}
                  accessibilityLabel="Delete reminder"
                >
                  <XIcon size={14} color={c.dim} />
                </Pressable>
              </View>
            </View>
            <Text style={s.remWhen}>{fmtWhen(r)}</Text>
          </View>
        ))
      )}
      {!data.phoneLinked && data.reminders.length > 0 && (
        <Text style={s.remWarn}>No phone linked yet — these can’t be delivered until you link one.</Text>
      )}
    </View>
  );
}

// Apple Health connect/status card. iOS-native only: the web sim gets a single
// muted line (the module never loads there — see src/health.ts), and Android
// doesn't render the card at all.
function AppleHealthCard({
  connected,
  lastSync,
  onConnect,
}: {
  connected: boolean;
  lastSync: { weights: number; workouts: number } | null;
  onConnect: () => Promise<void>;
}) {
  const s = useS();
  const [connecting, setConnecting] = useState(false);

  let body: ReactNode;
  if (Platform.OS === "web") {
    body = <Text style={s.healthMuted}>Apple Health sync needs the iPhone app</Text>;
  } else if (!healthSupported()) {
    body = <Text style={s.healthMuted}>Apple Health isn’t available in this build</Text>;
  } else if (connected) {
    const synced =
      lastSync && (lastSync.weights > 0 || lastSync.workouts > 0)
        ? ` · just pulled ${[
            lastSync.weights > 0 ? `${lastSync.weights} weigh-in${lastSync.weights === 1 ? "" : "s"}` : "",
            lastSync.workouts > 0 ? `${lastSync.workouts} workout${lastSync.workouts === 1 ? "" : "s"}` : "",
          ]
            .filter(Boolean)
            .join(", ")}`
        : "";
    body = <Text style={s.healthStatus}>Connected — weight & workouts sync when you open the app{synced}</Text>;
  } else {
    body = (
      <View style={s.healthRow}>
        <Text style={s.healthText}>Log weigh-ins and workouts automatically</Text>
        <Pressable
          style={s.healthConnect}
          disabled={connecting}
          accessibilityLabel="Connect Apple Health"
          onPress={async () => {
            setConnecting(true);
            try {
              await onConnect();
            } finally {
              setConnecting(false);
            }
          }}
        >
          <Text style={s.healthConnectText}>{connecting ? "…" : "CONNECT"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>APPLE HEALTH</Text>
      {body}
    </View>
  );
}

export function Today({
  onAuthError,
  onSubscriptionRequired,
  onOpenBody,
}: {
  onAuthError: (e: Error) => void;
  /**
   * 402 from the API. The shell swaps in the paywall rather than showing a raw
   * error. Omitted where there is no paywall (Android): the worker doesn't gate
   * Android clients, so a 402 there is shown as a plain inactive-account error.
   */
  onSubscriptionRequired?: () => void;
  /** Opens the Body screen (weigh-ins and measurements). */
  onOpenBody: () => void;
}) {
  const s = useS();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, twoColumn } = useContentWidth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [meals, setMeals] = useState<Meal[] | null>(null);
  const [reminders, setReminders] = useState<{ reminders: Reminder[]; phoneLinked: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthConnected, setHealthConnected] = useState(false);
  const [healthSync, setHealthSync] = useState<{ weights: number; workouts: number } | null>(null);

  const loadReminders = useCallback(async () => {
    try {
      setReminders(await listReminders());
    } catch {
      setReminders({ reminders: [], phoneLinked: false });
    }
  }, []);

  const loadMeals = useCallback(async () => {
    try {
      setMeals(await listMeals(todayLocal()));
    } catch {
      setMeals((m) => m ?? []);
    }
  }, []);

  const load = useCallback(async () => {
    const side = Promise.all([loadReminders(), loadMeals()]);
    // Pull new Apple Health samples first (no-op when not connected / not iOS)
    // so a fresh weigh-in shows up in the dashboard fetch below.
    try {
      const synced = await syncAppleHealth();
      setHealthConnected(synced != null);
      if (synced) setHealthSync(synced);
    } catch {
      // never let HealthKit trouble block the dashboard
    }
    try {
      setData(await dashboard());
      setError(null);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.message === "unauthorized") onAuthError(err);
      else if (err.message === "subscription required") {
        if (onSubscriptionRequired) onSubscriptionRequired();
        else setError("This account is not active.");
      }
      else setError(err.message);
    }
    await side;
  }, [onAuthError, onSubscriptionRequired, loadReminders, loadMeals]);

  // A meal edit or removal changes both the list and the day's totals.
  const onMealsChanged = useCallback(async () => {
    await loadMeals();
    try {
      setData(await dashboard());
    } catch {
      // the next pull-to-refresh or foreground reload catches up
    }
  }, [loadMeals]);

  const connectHealth = useCallback(async () => {
    const ok = await connectAppleHealth().catch(() => false);
    if (!ok) {
      Alert.alert("Apple Health", "Couldn’t connect. You can grant access later in Settings → Privacy & Security → Health.");
      return;
    }
    setHealthConnected(true);
    await load();
  }, [load]);

  useEffect(() => {
    // Reflect the persisted connection immediately (before the first sync
    // resolves) so the card doesn't flash the CONNECT button on relaunch.
    isHealthConnected().then(setHealthConnected).catch(() => {});
    load();
  }, [load]);

  // Foregrounding refetches: the iMessage agent may have logged food while the
  // app sat in the background, so the totals would otherwise be stale.
  // (Switching screens already remounts this one, which reloads.)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") load();
    });
    return () => sub.remove();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (error) return <View style={s.center}><Text style={s.err}>{error}</Text></View>;
  if (!data) return <View style={s.center}><Text style={s.muted}>loading…</Text></View>;

  const latestLb = data.weight.latestKg != null ? kgToLb(data.weight.latestKg) : null;
  const trend = data.weight.trend;
  const ins = weightInsight(latestLb, weeklyDeltaLb(trend), c);
  const bySite = (site: string) => data.measurementsLatest.find((m) => m.site === site);
  const waist = bySite("waist");
  const arm = bySite("arm_r") ?? bySite("arm_l");
  const ordered = [
    ...MEASUREMENT_SITES.map((site) => bySite(site)).filter((m): m is NonNullable<typeof m> => !!m),
    ...data.measurementsLatest.filter((m) => !(MEASUREMENT_SITES as readonly string[]).includes(m.site)),
  ];
  const kcal = data.nutritionToday?.kcal ?? 0;
  const protein = data.nutritionToday?.proteinG ?? 0;
  const kcalTarget = data.targets.dailyKcalTarget;
  const proteinTarget = data.targets.proteinTargetG;
  const kcalPct = kcalTarget ? Math.min(100, (kcal / kcalTarget) * 100) : 0;
  const proteinPct = proteinTarget ? Math.min(100, (protein / proteinTarget) * 100) : 0;
  const kcalOver = kcalTarget != null && kcal > kcalTarget;
  const proteinHit = proteinTarget != null && protein >= proteinTarget;

  // The body summary (glance strip, weight card, S:W, measurements) is the
  // way into the Body screen, so each of those is one big tap target.
  const glance = (
    <Pressable
      style={s.glance}
      onPress={onOpenBody}
      accessibilityRole="button"
      accessibilityLabel="Open body tracking"
    >
      <View style={s.gitem}><Text style={s.gval}>{latestLb != null ? latestLb.toFixed(1) : "—"}</Text><Text style={s.glabel}>WEIGHT LB</Text></View>
      <View style={s.gitem}><Text style={s.gval}>{data.shoulderToWaist != null ? data.shoulderToWaist.toFixed(2) : "—"}</Text><Text style={s.glabel}>S : W</Text></View>
      <View style={s.gitem}><Text style={s.gval}>{waist ? cmToIn(waist.valueCm).toFixed(1) : "—"}</Text><Text style={s.glabel}>WAIST IN</Text></View>
      <View style={s.gitem}><Text style={s.gval}>{arm ? cmToIn(arm.valueCm).toFixed(1) : "—"}</Text><Text style={s.glabel}>ARM IN</Text></View>
    </Pressable>
  );

  const weightCard = (
    <Pressable style={s.card} onPress={onOpenBody} accessibilityRole="button" accessibilityLabel="Weight. Open body tracking">
      <View style={s.cardHead}>
        <Text style={[s.cardLabel, s.shrink]}>WEIGHT / LB</Text>
        {ins.status && <Text style={[s.status, { color: ins.status.color }]}>{ins.status.label}</Text>}
      </View>
      <Text style={s.delta}>{ins.head}</Text>
      <View style={s.bigRow}>
        <Text style={[s.big, width < COMPACT_WIDTH && s.bigCompact]}>{latestLb != null ? latestLb.toFixed(1) : "—"}</Text>
        <Text style={s.bigUnit}>LB</Text>
      </View>
      <WeightChart trend={trend} />
      <View style={s.rangeRow}>
        <Text style={s.rangeText}>START {data.targets.startWeightKg != null ? kgToLb(data.targets.startWeightKg).toFixed(1) : "—"}</Text>
        <Text style={s.rangeText}>GOAL {data.targets.goalWeightKg != null ? kgToLb(data.targets.goalWeightKg).toFixed(1) : "—"}</Text>
      </View>
      <Text style={s.open}>WEIGH-INS & MEASUREMENTS ›</Text>
    </Pressable>
  );

  const nutritionCard = (
    <View style={s.card}>
      <Text style={s.cardLabel}>NUTRITION / TODAY</Text>
      <View style={s.nutRow}>
        <View style={s.nutTop}>
          <Text style={s.mname}>CALORIES</Text>
          <Text style={s.nutVal}>{kcal} / {kcalTarget ?? "—"} kcal</Text>
        </View>
        <View style={s.bar}>
          <View style={[s.barFill, { width: `${kcalPct}%` as DimensionValue, backgroundColor: kcalOver ? c.amber : c.info }]} />
        </View>
      </View>
      <View style={s.nutRow}>
        <View style={s.nutTop}>
          <Text style={s.mname}>PROTEIN</Text>
          <Text style={s.nutVal}>{Math.round(protein)} / {proteinTarget ?? "—"} g</Text>
        </View>
        <View style={s.bar}>
          <View style={[s.barFill, { width: `${proteinPct}%` as DimensionValue, backgroundColor: proteinHit ? c.amber : c.info }]} />
        </View>
      </View>
    </View>
  );

  const ratioCard = data.shoulderToWaist != null && (
    <Pressable style={s.card} onPress={onOpenBody} accessibilityRole="button" accessibilityLabel="Shoulder to waist ratio. Open body tracking">
      <Text style={s.cardLabel}>SHOULDER : WAIST</Text>
      <Text style={s.medium}>{data.shoulderToWaist.toFixed(3)}</Text>
      <Text style={s.mutedSmall}>higher = more V-taper, your "more muscular" metric</Text>
    </Pressable>
  );

  const measurementsCard = (
    <Pressable style={s.card} onPress={onOpenBody} accessibilityRole="button" accessibilityLabel="Measurements. Open body tracking">
      <Text style={s.cardLabel}>MEASUREMENTS / IN</Text>
      {ordered.length === 0 ? (
        <Text style={s.remEmpty}>no measurements yet — tap to add one</Text>
      ) : (
        ordered.map((m) => (
          <View key={m.site} style={s.mrow}>
            <Text style={[s.mname, s.shrink]}>{siteLabel(m.site).toUpperCase()}</Text>
            <Text style={s.mval}>{cmToIn(m.valueCm).toFixed(1)} <Text style={s.mutedSmall}>in</Text></Text>
          </View>
        ))
      )}
    </Pressable>
  );

  const mealsCard = <MealsCard meals={meals} onChanged={onMealsChanged} />;
  const remindersCard = reminders && <RemindersCard data={reminders} onChanged={loadReminders} />;
  // Apple Health is an iOS service; Android shows no card rather than naming another platform.
  const healthCard = Platform.OS !== "android" && (
    <AppleHealthCard connected={healthConnected} lastSync={healthSync} onConnect={connectHealth} />
  );

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingBottom: 40 + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.amber} colors={[c.amber]} progressBackgroundColor={c.card} />}
    >
      {glance}
      {twoColumn ? (
        // Landscape / wide: body on the left, the day's food on the right.
        <View style={s.columns}>
          <View style={s.column}>
            {weightCard}
            {ratioCard}
            {measurementsCard}
          </View>
          <View style={s.column}>
            {nutritionCard}
            {mealsCard}
            {remindersCard}
            {healthCard}
          </View>
        </View>
      ) : (
        <>
          {weightCard}
          {nutritionCard}
          {mealsCard}
          {ratioCard}
          {measurementsCard}
          {remindersCard}
          {healthCard}
        </>
      )}
    </ScrollView>
  );
}

const useS = makeStyles((c) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, gap: 14 },
    columns: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
    column: { flex: 1, minWidth: 0, gap: 14 },
    center: { flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24 },
    err: { color: c.error, textAlign: "center" },
    muted: { color: c.muted },
    mutedSmall: { color: c.muted, fontSize: 13, fontFamily: "monospace" },
    shrink: { flexShrink: 1 },
    // Wraps instead of running off the edge in a narrow window.
    glance: { flexDirection: "row", flexWrap: "wrap", columnGap: 20, rowGap: 10, paddingVertical: 6 },
    gitem: {},
    gval: { color: c.fg, fontSize: 24, fontWeight: "800" },
    glabel: { color: c.muted, fontSize: 10.5, fontFamily: "monospace", letterSpacing: 1, marginTop: 2 },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 16 },
    // Label and status wrap onto two lines rather than overlap when narrow.
    cardHead: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 12, marginBottom: 8 },
    cardLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 6 },
    status: { fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
    delta: { color: c.fg, fontSize: 21, fontWeight: "700", marginBottom: 4 },
    bigRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", columnGap: 8, marginBottom: 10 },
    big: { color: c.fg, fontSize: 64, fontWeight: "800", lineHeight: 68 },
    bigCompact: { fontSize: 42, lineHeight: 46 },
    bigUnit: { color: c.muted, fontSize: 16, fontFamily: "monospace", marginBottom: 12 },
    rangeRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 12, marginTop: 8 },
    rangeText: { color: c.muted, fontSize: 12.5, fontFamily: "monospace" },
    open: { color: c.amberText, fontSize: 11.5, fontFamily: "monospace", letterSpacing: 1, marginTop: 14 },
    medium: { color: c.fg, fontSize: 38, fontWeight: "800", marginVertical: 4 },
    mrow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    mname: { color: c.muted, fontSize: 13, fontFamily: "monospace", letterSpacing: 1 },
    mval: { color: c.fg, fontSize: 17, fontWeight: "600" },
    nutRow: { paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    nutTop: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", columnGap: 12, marginBottom: 8 },
    nutVal: { color: c.fg, fontSize: 14, fontFamily: "monospace" },
    bar: { height: 8, borderRadius: 999, backgroundColor: c.line, overflow: "hidden" },
    barFill: { height: "100%", borderRadius: 999 },
    remEmpty: { color: c.dim, fontSize: 12, fontFamily: "monospace", paddingVertical: 8 },
    remRow: { paddingVertical: 11 },
    remRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
    remTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
    remText: { flex: 1, color: c.fg, fontSize: 14.5, lineHeight: 19.5 },
    remOff: { color: c.dim, textDecorationLine: "line-through" },
    remActions: { flexDirection: "row", alignItems: "center", gap: 6 },
    remToggle: { borderWidth: 1, borderColor: c.line, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
    remToggleText: { color: c.muted, fontSize: 10, fontFamily: "monospace", letterSpacing: 0.8 },
    remDelete: { width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 7 },
    remWhen: { color: c.muted, fontSize: 11, fontFamily: "monospace", letterSpacing: 0.6, marginTop: 3 },
    remWarn: { color: c.attention, fontSize: 13, marginTop: 10 },
    healthMuted: { color: c.dim, fontSize: 12, fontFamily: "monospace", paddingVertical: 8 },
    healthStatus: { color: c.muted, fontSize: 13, lineHeight: 18, paddingVertical: 4 },
    healthRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingVertical: 4 },
    healthText: { flex: 1, color: c.fg, fontSize: 14.5, lineHeight: 19.5 },
    healthConnect: { borderWidth: 1, borderColor: c.amberText, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 13 },
    healthConnectText: { color: c.amberText, fontSize: 11, fontFamily: "monospace", letterSpacing: 1 },
  }),
);
