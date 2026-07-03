import { kgToLb, cmToIn, SITE_LABELS, MEASUREMENT_SITES } from "../shared/types";
import type { DashboardData } from "../shared/types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AreaChart } from "./Chart";
import { shiftDay, dayLabel, todayLocal } from "./dates";
import { FoodLog } from "./FoodLog";
import { WeightHistory } from "./WeightHistory";

const f1 = (n: number) => n.toFixed(1);
const DAY = 86_400_000;

function weeklyDeltaLb(trend: { ts: number; kg: number }[]): number | null {
  if (trend.length < 2) return null;
  // Anchor the week to the newest visible reading so past days read "as of".
  const cut = trend[trend.length - 1].ts - 7 * DAY;
  const win = trend.filter((p) => p.ts >= cut);
  const series = win.length >= 2 ? win : trend;
  return kgToLb(series[series.length - 1].kg) - kgToLb(series[0].kg);
}

function insight(latestLb: number | null, delta: number | null) {
  if (latestLb == null) return { head: "Log your first weigh-in", status: null as null | [string, string] };
  if (delta == null) return { head: "Tracking started — keep logging", status: ["info", "NEW"] as [string, string] };
  if (delta < -0.1) return { head: `Down ${Math.abs(delta).toFixed(1)} lb this week`, status: ["good", "ON TRACK"] as [string, string] };
  if (delta > 0.1) return { head: `Up ${delta.toFixed(1)} lb this week`, status: ["attention", "WATCH TREND"] as [string, string] };
  return { head: "Holding steady this week", status: ["info", "STEADY"] as [string, string] };
}

export function Dashboard({
  data,
  date,
  onDateChange,
  refreshKey,
  onChange,
}: {
  data: DashboardData;
  date: string;
  onDateChange: (d: string) => void;
  refreshKey: number;
  onChange: () => void;
}) {
  const isToday = date === todayLocal();
  const { weight, targets, measurementsLatest, shoulderToWaist, nutritionToday } = data;
  const latestLb = weight.latestKg != null ? kgToLb(weight.latestKg) : null;
  const avgLb = weight.weeklyAvgKg != null ? kgToLb(weight.weeklyAvgKg) : null;
  const goalLb = targets.goalWeightKg != null ? kgToLb(targets.goalWeightKg) : null;
  const startLb = targets.startWeightKg != null ? kgToLb(targets.startWeightKg) : null;
  const delta = weeklyDeltaLb(weight.trend);
  const ins = insight(latestLb, delta);

  let progressPct: number | null = null;
  if (latestLb != null && goalLb != null && startLb != null && startLb !== goalLb) {
    progressPct = Math.max(0, Math.min(100, ((startLb - latestLb) / (startLb - goalLb)) * 100));
  }

  const bySite = (s: string) => measurementsLatest.find((m) => m.site === s)?.valueCm;
  const waistIn = bySite("waist") != null ? cmToIn(bySite("waist")!) : null;
  const armCm = bySite("arm_r") ?? bySite("arm_l");
  const armIn = armCm != null ? cmToIn(armCm) : null;
  const orderedMeasurements = MEASUREMENT_SITES.map((s) => measurementsLatest.find((m) => m.site === s)).filter(
    (m): m is { site: string; valueCm: number; ts: number } => !!m,
  );

  // nutrition bars
  const kcal = nutritionToday?.kcal ?? null;
  const protein = nutritionToday?.proteinG ?? null;
  const kcalTarget = targets.dailyKcalTarget ?? 1850;
  const proteinTarget = targets.proteinTargetG ?? 160;
  const kcalPct = kcal != null ? Math.min(100, (kcal / kcalTarget) * 100) : 0;
  const proteinPct = protein != null ? Math.min(100, (protein / proteinTarget) * 100) : 0;
  const nutStatus = nutritionToday?.adherence
    ? ({ under: ["info", "UNDER"], on: ["good", "ON TARGET"], over: ["attention", "OVER"] } as const)[
        nutritionToday.adherence
      ]
    : null;

  return (
    <>
      {/* whole-day navigation: everything below reflects this day */}
      <div className="day-strip">
        <button className="daynav-btn" onClick={() => onDateChange(shiftDay(date, -1))} aria-label="Previous day">
          <ChevronLeft />
        </button>
        <span className="day-strip-label">{dayLabel(date)}</span>
        <button className="daynav-btn" onClick={() => onDateChange(shiftDay(date, 1))} disabled={isToday} aria-label="Next day">
          <ChevronRight />
        </button>
      </div>

      {/* glance strip */}
      <div className="glance">
        <div className="glance-item">
          <span className="glance-val">{latestLb != null ? f1(latestLb) : "—"}</span>
          <span className="glance-label">Weight lb</span>
        </div>
        <div className="glance-item">
          <span className="glance-val">{shoulderToWaist != null ? shoulderToWaist.toFixed(2) : "—"}</span>
          <span className="glance-label">S : W</span>
        </div>
        <div className="glance-item">
          <span className="glance-val">{waistIn != null ? f1(waistIn) : "—"}</span>
          <span className="glance-label">Waist in</span>
        </div>
        <div className="glance-item">
          <span className="glance-val">{armIn != null ? f1(armIn) : "—"}</span>
          <span className="glance-label">Arm in</span>
        </div>
      </div>

      <div className="grid">
        {/* WEIGHT HERO */}
        <section className="card hero">
          <div className="card-head">
            <p className="label">Weight / lb</p>
            {ins.status && <span className={`status ${ins.status[0]}`}>{ins.status[1]}</span>}
          </div>
          <p className="insight">{ins.head}</p>
          <p className="hero-num">
            {latestLb != null ? f1(latestLb) : "—"}
            <span className="unit"> lb</span>
          </p>
          <AreaChart points={weight.trend.map((p) => kgToLb(p.kg))} />
          {progressPct != null && (
            <>
              <div className="rangebar">
                <div className="rangebar-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="rangebar-ends">
                <span>START {startLb != null ? f1(startLb) : "—"}</span>
                <span>GOAL {goalLb != null ? f1(goalLb) : "—"}</span>
              </div>
            </>
          )}
          <div className="meta-row">
            <span className="meta">7-DAY AVG {avgLb != null ? f1(avgLb) : "—"}</span>
            {weight.bodyFatPct != null && <span className="meta">BF≈ {f1(weight.bodyFatPct)}% (noisy)</span>}
          </div>
          {weight.note && <p className="note-line">“{weight.note}”</p>}
        </section>

        {/* SHOULDER : WAIST */}
        <section className="card">
          <p className="label">Shoulder : Waist</p>
          <p className="big-num">{shoulderToWaist != null ? shoulderToWaist.toFixed(3) : "—"}</p>
          <p className="meta">higher = more V-taper · your "more muscular" metric</p>
        </section>

        {/* MEASUREMENTS */}
        <section className="card">
          <p className="label">Measurements / in</p>
          {orderedMeasurements.length === 0 ? (
            <p className="empty">no measurements yet — tap + to add</p>
          ) : (
            <div className="rows">
              {orderedMeasurements.map((m) => (
                <div className="crow" key={m.site}>
                  <div className="crow-top">
                    <span className="crow-label">{SITE_LABELS[m.site] ?? m.site}</span>
                    <span className="crow-val">
                      {f1(cmToIn(m.valueCm))}
                      <span className="unit"> in</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* NUTRITION */}
        <section className="card">
          <div className="card-head">
            <p className="label">Nutrition / {dayLabel(date)}</p>
            {nutStatus && <span className={`status ${nutStatus[0]}`}>{nutStatus[1]}</span>}
          </div>
          {nutritionToday == null ? (
            <p className="empty">log today's intake — tap +</p>
          ) : (
            <div className="rows">
              <div className="crow">
                <div className="crow-top">
                  <span className="crow-label">Calories</span>
                  <span className="crow-val">
                    {kcal ?? "—"}
                    <span className="unit"> / {kcalTarget}</span>
                  </span>
                </div>
                <div className="crow-bar">
                  <span className={kcal != null && kcal > kcalTarget ? "attention" : "info"} style={{ width: `${kcalPct}%` }} />
                </div>
              </div>
              <div className="crow">
                <div className="crow-top">
                  <span className="crow-label">Protein</span>
                  <span className="crow-val">
                    {protein ?? "—"}
                    <span className="unit"> / {proteinTarget} g</span>
                  </span>
                </div>
                <div className="crow-bar">
                  <span className={protein != null && protein >= proteinTarget ? "" : "info"} style={{ width: `${proteinPct}%` }} />
                </div>
              </div>
            </div>
          )}
        </section>

        <FoodLog date={date} refreshKey={refreshKey} onChange={onChange} />

        <WeightHistory />
      </div>
    </>
  );
}
