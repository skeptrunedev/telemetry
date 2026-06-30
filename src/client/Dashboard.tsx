import { useState } from "react";
import { kgToLb, cmToIn, SITE_LABELS, MEASUREMENT_SITES } from "../shared/types";
import type { DashboardData } from "../shared/types";
import { AreaChart } from "./Chart";
import { FoodLog } from "./FoodLog";

const f1 = (n: number) => n.toFixed(1);
const DAY = 86_400_000;

type Seg = "composition" | "nutrition" | "log";

function weeklyDeltaLb(trend: { ts: number; kg: number }[]): number | null {
  if (trend.length < 2) return null;
  const cut = Date.now() - 7 * DAY;
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

export function Dashboard({ data, refreshKey, onChange }: { data: DashboardData; refreshKey: number; onChange: () => void }) {
  const { weight, targets, measurementsLatest, shoulderToWaist, nutritionToday } = data;
  const [seg, setSeg] = useState<Seg>("composition");

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
    ? ({ under: ["info", "UNDER"], on: ["good", "ON TARGET"], over: ["attention", "OVER"] } as const)[nutritionToday.adherence]
    : null;

  const SEGS: { key: Seg; label: string }[] = [
    { key: "composition", label: "Composition" },
    { key: "nutrition", label: "Nutrition" },
    { key: "log", label: "Food log" },
  ];

  return (
    <div className="split">
      {/* pinned hero — the weight readout never scrolls away */}
      <section className="hero-fixed">
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

      {/* segmented control — the rest of the day lives behind this */}
      <div className="segbar" role="tablist">
        {SEGS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={seg === s.key}
            className={`seg ${seg === s.key ? "active" : ""}`}
            onClick={() => setSeg(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* scrollable detail for the active segment */}
      <div className="detail" key={seg}>
        {seg === "composition" && (
          <div className="grid">
            <section className="card">
              <p className="label">Shoulder : Waist</p>
              <p className="big-num">{shoulderToWaist != null ? shoulderToWaist.toFixed(3) : "—"}</p>
              <p className="meta">higher = more V-taper · your "more muscular" metric</p>
            </section>
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
          </div>
        )}

        {seg === "nutrition" && (
          <div className="grid">
            <section className="card">
              <div className="card-head">
                <p className="label">Nutrition / today</p>
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
          </div>
        )}

        {seg === "log" && (
          <div className="grid">
            <FoodLog refreshKey={refreshKey} onChange={onChange} />
          </div>
        )}
      </div>
    </div>
  );
}
