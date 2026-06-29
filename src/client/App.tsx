import { useCallback, useEffect, useState } from "react";
import type { DashboardData } from "../shared/types";
import { api, todayLocal } from "./api";
import { Dashboard } from "./Dashboard";
import { AddSheet } from "./AddSheet";

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api
      .dashboard(todayLocal())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">TELEMETRY</span>
        <span className="brand-sub">{todayLocal()}</span>
      </header>

      <main className="shell">
        {error && <p className="form-err">{error}</p>}
        {data ? <Dashboard data={data} /> : !error && <p className="meta">loading…</p>}
      </main>

      <button className="fab" aria-label="Add entry" onClick={() => setAdding(true)}>
        +
      </button>

      {adding && (
        <AddSheet
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}
