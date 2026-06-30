import { useCallback, useEffect, useState } from "react";
import type { DashboardData } from "../shared/types";
import { api, todayLocal } from "./api";
import { Today } from "./Dashboard";
import { Body, Food } from "./Dashboard";
import { AddSheet } from "./AddSheet";
import { WeightHistory } from "./WeightHistory";

type Tab = "today" | "body" | "food" | "photos";

const TABS: { key: Tab; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "body", label: "Body" },
  { key: "food", label: "Food" },
  { key: "photos", label: "Photos" },
];

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
  const [tab, setTab] = useState<Tab>("today");
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(() => {
    api
      .dashboard(todayLocal())
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // refresh dashboard totals AND signal child lists (FoodLog/WeightHistory) to refetch
  const reloadAll = useCallback(() => {
    load();
    setTick((t) => t + 1);
  }, [load]);

  useEffect(load, [load]);
  useEffect(() => {
    api.whoami().then((w) => setEmail(w.email)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">telemetry</span>
        <nav className="tabs-nav" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`navtab ${tab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <button className="add-btn" onClick={() => setAdding(true)}>
            + Add
          </button>
          {email && (
            <div className="account">
              <button
                className="avatar"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Account: ${email}`}
                title={email}
              >
                {email[0]}
              </button>
              {menuOpen && (
                <>
                  <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                  <div className="menu" role="menu">
                    <p className="menu-email">{email}</p>
                    <a
                      className="menu-item"
                      role="menuitem"
                      href="https://skeptrune.cloudflareaccess.com/cdn-cgi/access/logout"
                    >
                      Switch account
                    </a>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="shell">
        {error && <div className="scroll"><p className="form-err">{error}</p></div>}
        {!data && !error && <div className="scroll"><p className="meta">loading…</p></div>}
        {data && tab === "today" && (
          <div className="scroll">
            <div className="grid">
              <Today data={data} />
              <WeightHistory refreshKey={tick} />
            </div>
          </div>
        )}
        {data && tab === "body" && (
          <div className="scroll">
            <div className="grid">
              <Body data={data} />
            </div>
          </div>
        )}
        {data && tab === "food" && (
          <div className="scroll">
            <div className="grid">
              <Food data={data} refreshKey={tick} onChange={reloadAll} />
            </div>
          </div>
        )}
        {tab === "photos" && <div className="scroll"><Photos /></div>}
      </main>

      {adding && <AddSheet onClose={() => setAdding(false)} onChange={reloadAll} />}
    </div>
  );
}
