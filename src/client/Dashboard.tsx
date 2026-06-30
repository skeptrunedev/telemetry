import type { ReactNode } from "react";
import { kgToLb, cmToIn, SITE_LABELS, MEASUREMENT_SITES } from "../shared/types";
import type { DashboardData } from "../shared/types";
import { FoodLog } from "./FoodLog";

const f1 = (n: number) => n.toFixed(1);
const DAY = 86_400_000;

function weeklyDeltaLb(trend: { ts: number; kg: number }[]): number | null {
  if (trend.length < 2) return null;
  const cut = Date.now() - 7 * DAY;
  const win = trend.filter((p) => p.ts >= cut);
  const series = win.length >= 2 ? win : trend;
  return kgToLb(series[series.length - 1].kg) - kgToLb(series[0].kg);
}

/* ---- Today: weigh-ins rendered as a ranked HN story list ----
   The weigh-in list itself (with ids + inline note editing) lives in
   WeightHistory; Today just supplies the shared subtext context (7-day avg,
   start→goal, weekly delta) so the top item reads like a full HN story. */
export function Today({ data }: { data: DashboardData }) {
  const { weight, targets } = data;
  const avgLb = weight.weeklyAvgKg != null ? kgToLb(weight.weeklyAvgKg) : null;
  const goalLb = targets.goalWeightKg != null ? kgToLb(targets.goalWeightKg) : null;
  const startLb = targets.startWeightKg != null ? kgToLb(targets.startWeightKg) : null;
  const delta = weeklyDeltaLb(weight.trend);

  return (
    <div className="block">
      <p className="block-title">weigh-ins</p>
      <p className="totals-line">
        {avgLb != null ? `7-day avg ${f1(avgLb)} lb` : "no weigh-ins yet"}
        {startLb != null && goalLb != null && (
          <>
            {" · "}
            start {f1(startLb)} → goal {f1(goalLb)}
          </>
        )}
        {delta != null && (
          <>
            {" · "}
            {delta < 0 ? "▾" : "▴"}
            {Math.abs(delta).toFixed(1)} this wk
          </>
        )}
      </p>
    </div>
  );
}

/* ---- Body: shoulder:waist + measurements as story items ---- */
export function Body({ data }: { data: DashboardData }) {
  const { measurementsLatest, shoulderToWaist } = data;
  const ordered = MEASUREMENT_SITES.map((s) => measurementsLatest.find((m) => m.site === s)).filter(
    (m): m is { site: string; valueCm: number; ts: number } => !!m,
  );

  const items: { title: ReactNode; sub: ReactNode }[] = [];
  if (shoulderToWaist != null) {
    items.push({
      title: shoulderToWaist.toFixed(3),
      sub: "V-taper metric | shoulder : waist | higher = more muscular",
    });
  }
  for (const m of ordered) {
    items.push({
      title: `${SITE_LABELS[m.site] ?? m.site} ${f1(cmToIn(m.valueCm))} in`,
      sub: `${SITE_LABELS[m.site] ?? m.site} | ${fmtDate(m.ts)}`,
    });
  }

  return (
    <div className="block">
      <p className="block-title">body</p>
      {items.length === 0 ? (
        <p className="empty">no measurements yet — add one from the add link</p>
      ) : (
        <ol className="stories">
          {items.map((it, i) => (
            <li className="story" key={i}>
              <span className="story-rank">{i + 1}.</span>
              <span className="story-body">
                <div className="story-title">{it.title}</div>
                <div className="story-sub">{it.sub}</div>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/* ---- Food: nutrition totals line + meals as story items ---- */
export function Food({ data, refreshKey, onChange }: { data: DashboardData; refreshKey: number; onChange: () => void }) {
  const { targets, nutritionToday } = data;
  const kcal = nutritionToday?.kcal ?? null;
  const protein = nutritionToday?.proteinG ?? null;
  const kcalTarget = targets.dailyKcalTarget ?? 1850;
  const proteinTarget = targets.proteinTargetG ?? 160;

  return (
    <div className="block">
      <p className="block-title">food</p>
      <p className="totals-line">
        {kcal ?? "—"} / {kcalTarget} kcal · {protein ?? "—"} / {proteinTarget} g protein
      </p>
      <FoodLog refreshKey={refreshKey} onChange={onChange} />
    </div>
  );
}
