import { useCallback, useEffect, useState } from "react";
import { kgToLb } from "../shared/types";
import type { DashboardData } from "../shared/types";
import { api, todayLocal } from "./api";
import { Dashboard } from "./Dashboard";
import { AreaChart } from "./Chart";
import { AddSheet } from "./AddSheet";
import { BottomNav, type View } from "./BottomNav";

function Trends({ data }: { data: DashboardData }) {
  const latestLb = data.weight.latestKg != null ? kgToLb(data.weight.latestKg) : null;
  return (
    <div className="grid">
      <section className="card hero">
        <p className="label">Weight / lb · all time</p>
        <p className="hero-num">
          {latestLb != null ? latestLb.toFixed(1) : "—"}
          <span className="unit"> lb</span>
        </p>
        <AreaChart points={data.weight.trend.map((p) => kgToLb(p.kg))} height={120} />
        <p className="meta">{data.weight.trend.length} readings logged</p>
      </section>
      <section className="card">
        <p className="label">Shoulder : Waist</p>
        <p className="big-num">{data.shoulderToWaist != null ? data.shoulderToWaist.toFixed(3) : "—"}</p>
        <p className="meta">track this climbing as you lean out + build delts</p>
      </section>
    </div>
  );
}

function Photos() {
  return (
    <div className="view-empty">
      <p className="insight">Progress photos</p>
      <p className="meta">Photo log + side-by-side compare lands in P5.</p>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [view, setView] = useState<View>("today");
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    api
      .dashboard(todayLocal())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // refresh dashboard totals AND signal child lists (FoodLog) to refetch
  const reloadAll = useCallback(() => {
    load();
    setTick((t) => t + 1);
  }, [load]);

  useEffect(load, [load]);
  useEffect(() => {
    api.whoami().then((w) => setEmail(w.email)).catch(() => {});
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">TELEMETRY</span>
        <span className="brand-sub">{email ?? todayLocal()}</span>
      </header>

      <main className="shell">
        {error && <p className="form-err">{error}</p>}
        {!data && !error && <p className="meta">loading…</p>}
        {data && view === "today" && <Dashboard data={data} refreshKey={tick} onChange={reloadAll} />}
        {data && view === "trends" && <Trends data={data} />}
        {view === "photos" && <Photos />}
      </main>

      <BottomNav view={view} onChange={setView} onAdd={() => setAdding(true)} />

      {adding && <AddSheet onClose={() => setAdding(false)} onChange={reloadAll} />}
    </div>
  );
}
