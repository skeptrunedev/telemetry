import { kgToLb, cmToIn, SITE_LABELS } from "../shared/types";
import type { DashboardData } from "../shared/types";
import { Sparkline } from "./Sparkline";

const f1 = (n: number) => n.toFixed(1);

export function Dashboard({ data }: { data: DashboardData }) {
  const { weight, targets, measurementsLatest, shoulderToWaist, nutritionToday } = data;
  const latestLb = weight.latestKg != null ? kgToLb(weight.latestKg) : null;
  const avgLb = weight.weeklyAvgKg != null ? kgToLb(weight.weeklyAvgKg) : null;
  const goalLb = targets.goalWeightKg != null ? kgToLb(targets.goalWeightKg) : null;
  const startLb = targets.startWeightKg != null ? kgToLb(targets.startWeightKg) : null;

  // progress along start → goal
  let progressPct: number | null = null;
  if (latestLb != null && goalLb != null && startLb != null && startLb !== goalLb) {
    progressPct = Math.max(0, Math.min(100, ((startLb - latestLb) / (startLb - goalLb)) * 100));
  }

  return (
    <div className="grid">
      {/* WEIGHT HERO */}
      <section className="card hero">
        <p className="label">WEIGHT / LB</p>
        <p className="hero-num">{latestLb != null ? f1(latestLb) : "—"}</p>
        <Sparkline points={weight.trend.map((p) => kgToLb(p.kg))} />
        <div className="row">
          <span className="meta">7-DAY AVG {avgLb != null ? f1(avgLb) : "—"}</span>
          {goalLb != null && <span className="meta">GOAL {f1(goalLb)}</span>}
        </div>
        {progressPct != null && (
          <div className="rangebar">
            <div className="rangebar-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </section>

      {/* SHOULDER : WAIST */}
      <section className="card">
        <p className="label">SHOULDER : WAIST</p>
        <p className="big-num">{shoulderToWaist != null ? shoulderToWaist.toFixed(3) : "—"}</p>
        <p className="meta">higher = more V-taper · the "more muscular" metric</p>
      </section>

      {/* MEASUREMENTS */}
      <section className="card">
        <p className="label">MEASUREMENTS / IN</p>
        {measurementsLatest.length === 0 ? (
          <p className="meta">no measurements yet — tap + to add</p>
        ) : (
          <div className="measure-grid">
            {measurementsLatest.map((m) => (
              <div key={m.site} className="measure">
                <span className="measure-site">{SITE_LABELS[m.site] ?? m.site}</span>
                <span className="measure-val">{f1(cmToIn(m.valueCm))}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* NUTRITION */}
      <section className="card">
        <p className="label">NUTRITION / TODAY</p>
        <div className="row">
          <span className="big-num sm">
            {nutritionToday?.kcal != null ? nutritionToday.kcal : "—"}
            <span className="unit"> / {targets.dailyKcalTarget ?? "—"} kcal</span>
          </span>
        </div>
        <div className="row">
          <span className="big-num sm">
            {nutritionToday?.proteinG != null ? nutritionToday.proteinG : "—"}
            <span className="unit"> / {targets.proteinTargetG ?? "—"} g protein</span>
          </span>
          {nutritionToday?.hitProtein && <span className="badge ok">PROTEIN ✓</span>}
        </div>
        {nutritionToday?.adherence && (
          <p className="meta">today: {nutritionToday.adherence.toUpperCase()}</p>
        )}
      </section>
    </div>
  );
}
