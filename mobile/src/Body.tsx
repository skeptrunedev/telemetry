import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, ScrollView, RefreshControl, Pressable, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme } from "./theme";
import {
  listWeight, logWeight, setWeightNote, listMeasurements, addMeasurement,
  WeightReading, Measurement, kgToLb, lbToKg, cmToIn, inToCm,
} from "./api";
import { WeightChart } from "./WeightChart";
import { Sheet, Field } from "./Sheet";
import { MEASUREMENT_SITES, siteLabel } from "./sites";
import { useContentWidth, COMPACT_WIDTH } from "./layout";
import { weeklyDeltaLb, weightInsight } from "./weight";

const DAY = 86_400_000;
const PAGE = 30;
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDateYear = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// Body tracking: the weight trend and every weigh-in (with notes, like the
// web WeightHistory card), the latest reading per measurement site with its
// change since the one before, and the two manual log forms from the web
// AddSheet (weigh-in, measurement). Same worker endpoints as the web app.
export function Body({
  onAuthError,
  onSubscriptionRequired,
}: {
  onAuthError: (e: Error) => void;
  onSubscriptionRequired?: () => void;
}) {
  const s = useS();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, twoColumn } = useContentWidth();
  const [weights, setWeights] = useState<WeightReading[] | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [sheet, setSheet] = useState<"weight" | "measure" | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, m] = await Promise.all([listWeight(), listMeasurements()]);
      setWeights(w);
      setMeasurements(m);
      setError(null);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.message === "unauthorized") onAuthError(err);
      else if (err.message === "subscription required") {
        if (onSubscriptionRequired) onSubscriptionRequired();
        else setError("This account is not active.");
      } else setError(err.message);
    }
  }, [onAuthError, onSubscriptionRequired]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (error) return <View style={s.center}><Text style={s.err}>{error}</Text></View>;
  if (!weights || !measurements) return <View style={s.center}><Text style={s.muted}>loading…</Text></View>;

  // Oldest first for the chart and the week math.
  const trend = [...weights].reverse().map((w) => ({ ts: w.ts, kg: w.weightKg }));
  const latest = weights[0] ?? null;
  const latestLb = latest ? kgToLb(latest.weightKg) : null;
  const weekAgo = Date.now() - 7 * DAY;
  const lastWeek = weights.filter((w) => w.ts >= weekAgo);
  const avgLb = lastWeek.length ? lastWeek.reduce((a, w) => a + kgToLb(w.weightKg), 0) / lastWeek.length : null;
  const delta = weeklyDeltaLb(trend);
  const ins = weightInsight(latestLb, delta, c);

  // Latest reading per site (rows arrive newest first) plus the one before it.
  const bySite = new Map<string, Measurement[]>();
  for (const m of measurements) {
    const list = bySite.get(m.site) ?? [];
    if (list.length < 2) list.push(m);
    bySite.set(m.site, list);
  }
  const sites = [
    ...MEASUREMENT_SITES.filter((site) => bySite.has(site)),
    ...[...bySite.keys()].filter((site) => !(MEASUREMENT_SITES as readonly string[]).includes(site)),
  ];

  const summary = (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={[s.cardLabel, s.shrink]}>WEIGHT / LB</Text>
        {ins.status && <Text style={[s.status, { color: ins.status.color }]}>{ins.status.label}</Text>}
      </View>
      <Text style={s.insight}>{ins.head}</Text>
      <View style={s.bigRow}>
        <Text style={[s.big, width < COMPACT_WIDTH && s.bigCompact]}>{latestLb != null ? latestLb.toFixed(1) : "—"}</Text>
        <Text style={s.bigUnit}>LB</Text>
      </View>
      <WeightChart trend={trend} height={130} />
      <View style={s.metaRow}>
        <Text style={s.meta}>7-DAY AVG {avgLb != null ? avgLb.toFixed(1) : "—"}</Text>
        {latest?.bodyFatPct != null && <Text style={s.meta}>BF≈ {latest.bodyFatPct.toFixed(1)}% (noisy)</Text>}
      </View>
      <View style={s.actions}>
        <Pressable style={s.action} onPress={() => setSheet("weight")} accessibilityRole="button">
          <Text style={s.actionText}>+ LOG WEIGH-IN</Text>
        </Pressable>
        <Pressable style={s.actionGhost} onPress={() => setSheet("measure")} accessibilityRole="button">
          <Text style={s.actionGhostText}>+ MEASUREMENT</Text>
        </Pressable>
      </View>
    </View>
  );

  const measurementsCard = (
    <View style={s.card}>
      <Text style={s.cardLabel}>MEASUREMENTS / IN</Text>
      {sites.length === 0 ? (
        <Text style={s.empty}>no measurements yet — tap + MEASUREMENT to add one</Text>
      ) : (
        sites.map((site) => {
          const [now, prev] = bySite.get(site)!;
          const d = prev ? cmToIn(now.valueCm) - cmToIn(prev.valueCm) : null;
          return (
            <View key={site} style={s.row}>
              <View style={s.rowMain}>
                <Text style={s.rowLabel}>{siteLabel(site)}</Text>
                <Text style={s.rowSub}>
                  {fmtDate(now.ts)}
                  {d != null && Math.abs(d) >= 0.05 ? ` · ${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} since ${fmtDate(prev!.ts)}` : ""}
                </Text>
              </View>
              <Text style={s.rowVal}>
                {cmToIn(now.valueCm).toFixed(1)}
                <Text style={s.unit}> in</Text>
              </Text>
            </View>
          );
        })
      )}
    </View>
  );

  const historyCard = (
    <View style={s.card}>
      <Text style={s.cardLabel}>WEIGH-INS · TAP TO NOTE</Text>
      {weights.length === 0 ? (
        <Text style={s.empty}>no weigh-ins yet</Text>
      ) : (
        weights.slice(0, shown).map((w) => <WeighIn key={w.id} reading={w} onSaved={load} />)
      )}
      {weights.length > shown && (
        <Pressable style={s.more} onPress={() => setShown((n) => n + PAGE)} accessibilityRole="button">
          <Text style={s.moreText}>SHOW {Math.min(PAGE, weights.length - shown)} MORE</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: 40 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.amber} colors={[c.amber]} progressBackgroundColor={c.card} />}
      >
        {twoColumn ? (
          <View style={s.columns}>
            <View style={s.column}>
              {summary}
              {measurementsCard}
            </View>
            <View style={s.column}>{historyCard}</View>
          </View>
        ) : (
          <>
            {summary}
            {measurementsCard}
            {historyCard}
          </>
        )}
      </ScrollView>
      <WeightSheet open={sheet === "weight"} onClose={() => setSheet(null)} onSaved={load} />
      <MeasureSheet open={sheet === "measure"} onClose={() => setSheet(null)} onSaved={load} />
    </>
  );
}

// One weigh-in row with an inline note editor, as in the web WeightHistory:
// the note saves on submit or when the field loses focus, only if it changed.
function WeighIn({ reading, onSaved }: { reading: WeightReading; onSaved: () => void }) {
  const s = useS();
  const { c } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const close = async () => {
    if (!editing) return;
    const next = draft.trim();
    if (next === (reading.note ?? "")) return setEditing(false);
    setBusy(true);
    try {
      await setWeightNote(reading.id, next || null);
      setEditing(false);
      onSaved();
    } catch {
      // keep the editor open so the text isn't lost
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.row}>
      <View style={s.rowMain}>
        <Text style={s.rowLabel}>
          {fmtDateYear(reading.ts)}
          <Text style={s.rowSub}>{reading.source !== "manual" ? ` · ${reading.source}` : ""}</Text>
        </Text>
        {editing ? (
          <TextInput
            autoFocus
            style={[s.noteInput, Platform.OS === "web" && WEB_NO_RING]}
            value={draft}
            editable={!busy}
            onChangeText={setDraft}
            placeholder="add a note…"
            placeholderTextColor={c.dim}
            maxLength={500}
            returnKeyType="done"
            onSubmitEditing={close}
            onBlur={close}
          />
        ) : (
          <Pressable
            onPress={() => {
              setDraft(reading.note ?? "");
              setEditing(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={reading.note ? "Edit note" : "Add note"}
            hitSlop={6}
          >
            <Text style={reading.note ? s.note : s.addNote}>{reading.note ? `“${reading.note}”` : "+ add note"}</Text>
          </Pressable>
        )}
      </View>
      <Text style={s.rowVal}>
        {kgToLb(reading.weightKg).toFixed(1)}
        <Text style={s.unit}> lb</Text>
      </Text>
    </View>
  );
}

const WEB_NO_RING = { outlineStyle: "none", outlineWidth: 0 } as unknown as object;

function WeightSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [lb, setLb] = useState("");
  const [bf, setBf] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };
  // Same bounds as the web AddSheet.
  const save = async () => {
    const v = parseFloat(lb);
    if (!isFinite(v) || v < 30 || v > 700) return setError("Enter a weight between 30 and 700 lb");
    const bfv = bf.trim() ? parseFloat(bf) : null;
    if (bfv != null && (!isFinite(bfv) || bfv < 1 || bfv > 80)) return setError("Body fat % must be 1–80");
    setSaving(true);
    setError(null);
    try {
      await logWeight(lbToKg(v), note.trim() || null, bfv);
      setLb("");
      setBf("");
      setNote("");
      onClose();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} title="Log a weigh-in" onClose={close} onSave={save} saving={saving} error={error}>
      <Field label="WEIGHT (LB)" value={lb} onChangeText={setLb} keyboardType="decimal-pad" placeholder="160.0" autoFocus />
      <Field label="BODY FAT % (OPTIONAL, NOISY)" value={bf} onChangeText={setBf} keyboardType="decimal-pad" placeholder="20" />
      <Field label="NOTE (OPTIONAL)" value={note} onChangeText={setNote} placeholder="post-workout, dehydrated, …" maxLength={500} />
    </Sheet>
  );
}

function MeasureSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const s = useS();
  const [site, setSite] = useState<string>("shoulders");
  const [inches, setInches] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };
  const save = async () => {
    const v = parseFloat(inches);
    if (!isFinite(v) || v < 1 || v > 120) return setError("Enter a measurement between 1 and 120 in");
    setSaving(true);
    setError(null);
    try {
      await addMeasurement(site, inToCm(v));
      setInches("");
      onClose();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} title="Add a measurement" onClose={close} onSave={save} saving={saving} error={error}>
      <Text style={s.fieldLabel}>SITE</Text>
      <View style={s.sites} accessibilityRole="radiogroup">
        {MEASUREMENT_SITES.map((m) => (
          <Pressable
            key={m}
            style={[s.site, site === m && s.siteOn]}
            onPress={() => setSite(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: site === m }}
          >
            <Text style={[s.siteText, site === m && s.siteTextOn]}>{siteLabel(m)}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="MEASUREMENT (IN)" value={inches} onChangeText={setInches} keyboardType="decimal-pad" placeholder="15.0" />
    </Sheet>
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
    shrink: { flexShrink: 1 },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.line, padding: 16 },
    cardHead: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", columnGap: 12, marginBottom: 8 },
    cardLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1.5, marginBottom: 6 },
    status: { fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
    insight: { color: c.fg, fontSize: 21, fontWeight: "700", marginBottom: 4 },
    bigRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", columnGap: 8, marginBottom: 10 },
    big: { color: c.fg, fontSize: 56, fontWeight: "800", lineHeight: 60 },
    bigCompact: { fontSize: 42, lineHeight: 46 },
    bigUnit: { color: c.muted, fontSize: 16, fontFamily: "monospace", marginBottom: 10 },
    metaRow: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4, marginTop: 8 },
    meta: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 0.6 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
    action: { backgroundColor: c.amber, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
    actionText: { color: c.amberInk, fontSize: 12, fontFamily: "monospace", letterSpacing: 1, fontWeight: "700" },
    actionGhost: { borderWidth: 1, borderColor: c.amberText, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
    actionGhostText: { color: c.amberText, fontSize: 12, fontFamily: "monospace", letterSpacing: 1, fontWeight: "700" },
    empty: { color: c.dim, fontSize: 12, fontFamily: "monospace", paddingVertical: 8 },
    row: {
      flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line,
    },
    rowMain: { flex: 1, minWidth: 0, gap: 3 },
    rowLabel: { color: c.fg, fontSize: 14.5 },
    rowSub: { color: c.muted, fontSize: 12, fontFamily: "monospace" },
    rowVal: { color: c.fg, fontSize: 17, fontWeight: "600" },
    unit: { color: c.muted, fontSize: 13, fontWeight: "400" },
    note: { color: c.muted, fontSize: 13, fontStyle: "italic" },
    addNote: { color: c.dim, fontSize: 12.5 },
    noteInput: {
      borderWidth: 1, borderColor: c.amberText, borderRadius: 8, backgroundColor: c.field, color: c.fg,
      paddingHorizontal: 10, paddingVertical: 6, fontSize: 14,
    },
    more: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 14, marginTop: 4 },
    moreText: { color: c.amberText, fontSize: 11.5, fontFamily: "monospace", letterSpacing: 1 },
    fieldLabel: { color: c.muted, fontSize: 12, fontFamily: "monospace", letterSpacing: 1 },
    sites: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    site: { borderWidth: 1, borderColor: c.line, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
    siteOn: { backgroundColor: c.amber, borderColor: c.amber },
    siteText: { color: c.fg, fontSize: 13.5 },
    siteTextOn: { color: c.amberInk, fontWeight: "700" },
  }),
);
