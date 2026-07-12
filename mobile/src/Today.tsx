import { useCallback, useEffect, useState, type ReactNode } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet, Pressable, Alert, Platform, type DimensionValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Circle } from "react-native-svg";
import { C } from "./theme";
import { dashboard, Dashboard, kgToLb, cmToIn, listReminders, deleteReminder, setReminderEnabled, Reminder } from "./api";
import { healthSupported, isHealthConnected, connectAppleHealth, syncAppleHealth } from "./health";
import { XIcon } from "./icons";

const SITE_LABELS: Record<string, string> = {
  shoulders: "SHOULDERS", chest: "CHEST", arm_l: "ARM (L)", arm_r: "ARM (R)",
  waist: "WAIST", neck: "NECK", thigh: "THIGH", glutes: "GLUTES",
  forearm_l: "FOREARM (L)", forearm_r: "FOREARM (R)", calf_l: "CALF (L)", calf_r: "CALF (R)",
};

function TrendChart({ trend }: { trend: { ts: number; kg: number }[] }) {
  const W = 320, H = 110;
  if (trend.length < 2) return <View style={{ height: H }} />;
  const xs = trend.map((p) => p.ts);
  const ys = trend.map((p) => kgToLb(p.kg));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys) - 0.4, y1 = Math.max(...ys) + 0.4;
  const px = (t: number) => ((t - x0) / (x1 - x0 || 1)) * W;
  const py = (v: number) => H - ((v - y0) / (y1 - y0 || 1)) * H;
  const d = trend.map((p, i) => `${i ? "L" : "M"} ${px(p.ts).toFixed(1)} ${py(kgToLb(p.kg)).toFixed(1)}`).join(" ");
  const area = `${d} L ${W} ${H} L 0 ${H} Z`;
  const last = trend[trend.length - 1];
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Path d={area} fill={C.amber} opacity={0.16} />
      <Path d={d} stroke={C.amber} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={px(last.ts)} cy={py(kgToLb(last.kg))} r={4} fill={C.amber} />
    </Svg>
  );
}

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
                  <XIcon size={14} color={C.dim} />
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

// Apple Health connect/status card. iOS-native only: Android and the web sim
// get a single muted line (the module never loads there — see src/health.ts).
function AppleHealthCard({
  connected,
  lastSync,
  onConnect,
}: {
  connected: boolean;
  lastSync: { weights: number; workouts: number } | null;
  onConnect: () => Promise<void>;
}) {
  const [connecting, setConnecting] = useState(false);

  let body: ReactNode;
  if (Platform.OS === "android") {
    body = <Text style={s.healthMuted}>Apple Health is iPhone only</Text>;
  } else if (Platform.OS === "web") {
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

export function Today({ onAuthError }: { onAuthError: (e: Error) => void }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Dashboard | null>(null);
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

  const load = useCallback(async () => {
    const rem = loadReminders();
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
      else setError(err.message);
    }
    await rem;
  }, [onAuthError, loadReminders]);

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

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (error) return <View style={s.center}><Text style={s.err}>{error}</Text></View>;
  if (!data) return <View style={s.center}><Text style={s.muted}>loading…</Text></View>;

  const latestLb = data.weight.latestKg != null ? kgToLb(data.weight.latestKg) : null;
  const trend = data.weight.trend;
  // week-over-week from the trend, mirrors the web hero
  let deltaLine = "";
  if (trend.length > 1) {
    const now = trend[trend.length - 1].ts;
    const wk = 7 * 86_400_000;
    const thisWeek = trend.filter((p) => p.ts > now - wk).map((p) => kgToLb(p.kg));
    const prevWeek = trend.filter((p) => p.ts <= now - wk && p.ts > now - 2 * wk).map((p) => kgToLb(p.kg));
    if (thisWeek.length && prevWeek.length) {
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const d = avg(prevWeek) - avg(thisWeek);
      deltaLine = d >= 0 ? `Down ${d.toFixed(1)} lb this week` : `Up ${(-d).toFixed(1)} lb this week`;
    }
  }
  const bySite = (site: string) => data.measurementsLatest.find((m) => m.site === site);
  const waist = bySite("waist");
  const arm = bySite("arm_r") ?? bySite("arm_l");
  const kcal = data.nutritionToday?.kcal ?? 0;
  const protein = data.nutritionToday?.proteinG ?? 0;
  const kcalTarget = data.targets.dailyKcalTarget;
  const proteinTarget = data.targets.proteinTargetG;
  const kcalPct = kcalTarget ? Math.min(100, (kcal / kcalTarget) * 100) : 0;
  const proteinPct = proteinTarget ? Math.min(100, (protein / proteinTarget) * 100) : 0;
  const kcalOver = kcalTarget != null && kcal > kcalTarget;
  const proteinHit = proteinTarget != null && protein >= proteinTarget;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingBottom: 40 + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.amber} />}
    >
      <View style={s.glance}>
        <View style={s.gitem}><Text style={s.gval}>{latestLb != null ? latestLb.toFixed(1) : "—"}</Text><Text style={s.glabel}>WEIGHT LB</Text></View>
        <View style={s.gitem}><Text style={s.gval}>{data.shoulderToWaist != null ? data.shoulderToWaist.toFixed(2) : "—"}</Text><Text style={s.glabel}>S : W</Text></View>
        <View style={s.gitem}><Text style={s.gval}>{waist ? cmToIn(waist.valueCm).toFixed(1) : "—"}</Text><Text style={s.glabel}>WAIST IN</Text></View>
        <View style={s.gitem}><Text style={s.gval}>{arm ? cmToIn(arm.valueCm).toFixed(1) : "—"}</Text><Text style={s.glabel}>ARM IN</Text></View>
      </View>

      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardLabel}>WEIGHT / LB</Text>
          <Text style={s.onTrack}>ON TRACK</Text>
        </View>
        {deltaLine ? <Text style={s.delta}>{deltaLine}</Text> : null}
        <View style={s.bigRow}>
          <Text style={s.big}>{latestLb != null ? latestLb.toFixed(1) : "—"}</Text>
          <Text style={s.bigUnit}>LB</Text>
        </View>
        <TrendChart trend={trend} />
        <View style={s.rangeRow}>
          <Text style={s.rangeText}>START {data.targets.startWeightKg != null ? kgToLb(data.targets.startWeightKg).toFixed(1) : "—"}</Text>
          <Text style={s.rangeText}>GOAL {data.targets.goalWeightKg != null ? kgToLb(data.targets.goalWeightKg).toFixed(1) : "—"}</Text>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>NUTRITION / TODAY</Text>
        <View style={s.nutRow}>
          <View style={s.nutTop}>
            <Text style={s.mname}>CALORIES</Text>
            <Text style={s.nutVal}>{kcal} / {kcalTarget ?? "—"} kcal</Text>
          </View>
          <View style={s.bar}>
            <View style={[s.barFill, { width: `${kcalPct}%` as DimensionValue, backgroundColor: kcalOver ? C.amber : C.info }]} />
          </View>
        </View>
        <View style={s.nutRow}>
          <View style={s.nutTop}>
            <Text style={s.mname}>PROTEIN</Text>
            <Text style={s.nutVal}>{Math.round(protein)} / {proteinTarget ?? "—"} g</Text>
          </View>
          <View style={s.bar}>
            <View style={[s.barFill, { width: `${proteinPct}%` as DimensionValue, backgroundColor: proteinHit ? C.amber : C.info }]} />
          </View>
        </View>
      </View>

      {data.shoulderToWaist != null && (
        <View style={s.card}>
          <Text style={s.cardLabel}>SHOULDER : WAIST</Text>
          <Text style={s.medium}>{data.shoulderToWaist.toFixed(3)}</Text>
          <Text style={s.mutedSmall}>higher = more V-taper, your "more muscular" metric</Text>
        </View>
      )}

      {data.measurementsLatest.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardLabel}>MEASUREMENTS / IN</Text>
          {data.measurementsLatest.map((m) => (
            <View key={m.site} style={s.mrow}>
              <Text style={s.mname}>{SITE_LABELS[m.site] ?? m.site.toUpperCase()}</Text>
              <Text style={s.mval}>{cmToIn(m.valueCm).toFixed(1)} <Text style={s.mutedSmall}>in</Text></Text>
            </View>
          ))}
        </View>
      )}

      {reminders && <RemindersCard data={reminders} onChanged={loadReminders} />}

      <AppleHealthCard connected={healthConnected} lastSync={healthSync} onConnect={connectHealth} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  center: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" },
  err: { color: "#ff8a70" },
  muted: { color: C.muted },
  mutedSmall: { color: C.muted, fontSize: 13, fontFamily: "monospace" },
  glance: { flexDirection: "row", gap: 20, paddingVertical: 6 },
  gitem: {},
  gval: { color: C.fg, fontSize: 24, fontWeight: "800" },
  glabel: { color: C.muted, fontSize: 10.5, fontFamily: "monospace", letterSpacing: 1, marginTop: 2 },
  card: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  cardLabel: { color: C.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 6 },
  onTrack: { color: C.amber, fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
  delta: { color: C.fg, fontSize: 21, fontWeight: "700", marginBottom: 4 },
  bigRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 10 },
  big: { color: C.fg, fontSize: 64, fontWeight: "800", lineHeight: 68 },
  bigUnit: { color: C.muted, fontSize: 16, fontFamily: "monospace", marginBottom: 12 },
  rangeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  rangeText: { color: C.muted, fontSize: 12.5, fontFamily: "monospace" },
  medium: { color: C.fg, fontSize: 38, fontWeight: "800", marginVertical: 4 },
  mrow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  mname: { color: C.muted, fontSize: 13, fontFamily: "monospace", letterSpacing: 1 },
  mval: { color: C.fg, fontSize: 17, fontWeight: "600" },
  nutRow: { paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  nutTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  nutVal: { color: C.fg, fontSize: 14, fontFamily: "monospace" },
  bar: { height: 8, borderRadius: 999, backgroundColor: C.line, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 999 },
  remEmpty: { color: C.dim, fontSize: 12, fontFamily: "monospace", paddingVertical: 8 },
  remRow: { paddingVertical: 11 },
  remRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  remTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  remText: { flex: 1, color: C.fg, fontSize: 14.5, lineHeight: 19.5 },
  remOff: { color: C.dim, textDecorationLine: "line-through" },
  remActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  remToggle: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  remToggleText: { color: C.muted, fontSize: 10, fontFamily: "monospace", letterSpacing: 0.8 },
  remDelete: { width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  remWhen: { color: C.muted, fontSize: 11, fontFamily: "monospace", letterSpacing: 0.6, marginTop: 3 },
  remWarn: { color: C.attention, fontSize: 13, marginTop: 10 },
  healthMuted: { color: C.dim, fontSize: 12, fontFamily: "monospace", paddingVertical: 8 },
  healthStatus: { color: C.muted, fontSize: 13, lineHeight: 18, paddingVertical: 4 },
  healthRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingVertical: 4 },
  healthText: { flex: 1, color: C.fg, fontSize: 14.5, lineHeight: 19.5 },
  healthConnect: { borderWidth: 1, borderColor: C.amber, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 13 },
  healthConnectText: { color: C.amber, fontSize: 11, fontFamily: "monospace", letterSpacing: 1 },
});
