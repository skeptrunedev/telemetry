// Weigh-in history summary for the coach's get_weight_history tool. Pure (no
// Worker or DB imports) so it can be unit-tested directly.

const DAY_MS = 86_400_000;
const LB_PER_KG = 2.2046226218;
const MAX_READINGS = 120;

export interface WeightRow {
  ts: Date;
  weightKg: number;
  bodyFatPct: number | null;
  note: string | null;
}

/**
 * Summarize weigh-ins between two local days (YYYY-MM-DD, inclusive; `from`
 * null = the first weigh-in). `tzMin` is the client's getTimezoneOffset. The
 * lb/week trend is a least-squares slope over every reading, which daily water
 * swings barely move, unlike a first-vs-last difference. Rows must be sorted
 * oldest first.
 */
export function summarizeWeightHistory(all: WeightRow[], from: string | null, to: string, tzMin: number) {
  const localDay = (t: Date) => new Date(t.getTime() - tzMin * 60_000).toISOString().slice(0, 10);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const rows = all
    .map((r) => ({ day: localDay(r.ts), t: r.ts.getTime(), lb: r.weightKg * LB_PER_KG, bodyFatPct: r.bodyFatPct, note: r.note }))
    .filter((r) => (from == null || r.day >= from) && r.day <= to);
  if (!rows.length) return { count: 0, message: all.length ? "no weigh-ins in that range" : "no weigh-ins logged yet" };

  const first = rows[0];
  const latest = rows[rows.length - 1];
  const days = (latest.t - first.t) / DAY_MS;

  let lbPerWeek: number | null = null;
  if (rows.length >= 2 && days >= 1) {
    const mt = rows.reduce((s, r) => s + r.t, 0) / rows.length;
    const mw = rows.reduce((s, r) => s + r.lb, 0) / rows.length;
    const num = rows.reduce((s, r) => s + (r.t - mt) * (r.lb - mw), 0);
    const den = rows.reduce((s, r) => s + (r.t - mt) ** 2, 0);
    if (den > 0) lbPerWeek = round1((num / den) * 7 * DAY_MS);
  }

  // Averages per week, weeks starting Monday.
  const weeks = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const d = new Date(`${r.day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const k = d.toISOString().slice(0, 10);
    const w = weeks.get(k) ?? { sum: 0, n: 0 };
    w.sum += r.lb;
    w.n += 1;
    weeks.set(k, w);
  }
  const weeklyAverages = [...weeks.entries()].map(([weekOf, w]) => ({ weekOf, avgPounds: round1(w.sum / w.n), weighIns: w.n }));

  // Every reading when it fits, otherwise one averaged reading per day (newest days kept).
  let readings: { date: string; pounds: number; bodyFatPct?: number | null; note?: string | null; weighIns?: number }[];
  if (rows.length <= MAX_READINGS) {
    readings = rows.map((r) => ({ date: r.day, pounds: round1(r.lb), bodyFatPct: r.bodyFatPct, note: r.note }));
  } else {
    const byDay = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      const d = byDay.get(r.day) ?? { sum: 0, n: 0 };
      d.sum += r.lb;
      d.n += 1;
      byDay.set(r.day, d);
    }
    readings = [...byDay.entries()].map(([date, d]) => ({ date, pounds: round1(d.sum / d.n), weighIns: d.n })).slice(-MAX_READINGS);
  }

  return {
    count: rows.length,
    first: { date: first.day, pounds: round1(first.lb) },
    latest: { date: latest.day, pounds: round1(latest.lb) },
    totalChangePounds: round1(latest.lb - first.lb),
    spanDays: Math.round(days),
    trendPoundsPerWeek: lbPerWeek,
    weeklyAverages,
    readings,
    readingsAreDailyAverages: rows.length > MAX_READINGS,
  };
}
