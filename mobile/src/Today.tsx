import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Circle } from "react-native-svg";
import { C } from "./theme";
import { dashboard, Dashboard, kgToLb, cmToIn } from "./api";

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

export function Today({ onAuthError }: { onAuthError: (e: Error) => void }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Dashboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await dashboard());
      setError(null);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.message === "unauthorized") onAuthError(err);
      else setError(err.message);
    }
  }, [onAuthError]);

  useEffect(() => {
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

      <View style={s.card}>
        <Text style={s.cardLabel}>NUTRITION / TODAY</Text>
        <View style={s.mrow}>
          <Text style={s.mname}>CALORIES</Text>
          <Text style={s.mval}>{kcal} / {data.targets.dailyKcalTarget ?? "—"}</Text>
        </View>
        <View style={s.mrow}>
          <Text style={s.mname}>PROTEIN</Text>
          <Text style={s.mval}>{Math.round(protein)} / {data.targets.proteinTargetG ?? "—"} g</Text>
        </View>
      </View>
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
});
