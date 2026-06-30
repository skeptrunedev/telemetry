import { useCallback, useEffect, useState } from "react";
import type { DashboardData } from "../shared/types";
import { api, todayLocal } from "./api";
import { Today } from "./Dashboard";
import { Body, Food } from "./Dashboard";
import { AddSheet } from "./AddSheet";
import { WeightHistory } from "./WeightHistory";

type Tab = "today" | "body" | "food" | "photos";

const TABS: { key: Tab; label: string }[] = [
  { key: "today", label: "today" },
  { key: "body", label: "body" },
  { key: "food", label: "food" },
  { key: "photos", label: "photos" },
];

function Photos() {
  return (
    <div className="block">
      <p className="block-title">Progress photos</p>
      <p className="empty">Photo log + side-by-side compare lands in P5.</p>
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
        <span className="logo-box" aria-hidden="true">T</span>
        <span className="brand">Telemetry</span>
        <nav className="topbar-nav" aria-label="Sections">
          {TABS.map((t, i) => (
            <span key={t.key} style={{ display: "contents" }}>
              {i > 0 && <span className="sep">|</span>}
              <button
                className={`navlink ${tab === t.key ? "active" : ""}`}
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
              >
                {t.label}
              </button>
            </span>
          ))}
          <span className="sep">|</span>
          <button className="navlink" onClick={() => setAdding(true)}>
            add
          </button>
        </nav>
        <span className="topbar-spacer" />
        {email && (
          <span className="account">
            <button
              className="navlink"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={email}
            >
              {email}
            </button>
            <span className="sep">|</span>
            <button className="navlink" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu">
              logout
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
          </span>
        )}
      </header>

      <main className="shell">
        <div className="scroll">
          {error && <p className="form-err">{error}</p>}
          {!data && !error && <p className="empty">loading…</p>}

          {data && tab === "today" && (
            <>
              <Today data={data} />
              <WeightHistory refreshKey={tick} />
            </>
          )}
          {data && tab === "body" && <Body data={data} />}
          {data && tab === "food" && <Food data={data} refreshKey={tick} onChange={reloadAll} />}
          {tab === "photos" && <Photos />}

          <Footer onSwitchAccount={() => setMenuOpen(true)} />
        </div>
      </main>

      {adding && <AddSheet onClose={() => setAdding(false)} onChange={reloadAll} />}
    </div>
  );
}

function Footer({ onSwitchAccount }: { onSwitchAccount: () => void }) {
  return (
    <footer className="footer">
      <div>
        <a href="/openapi.json">openapi</a>
        <span className="footsep">·</span>
        <a href="https://github.com/skeptrunedev/telemetry/releases" target="_blank" rel="noreferrer">
          cli
        </a>
        <span className="footsep">·</span>
        <button className="linkbtn" onClick={onSwitchAccount}>
          switch account
        </button>
      </div>
      <div className="footer-search">
        <label>
          Search:
          <input type="text" disabled aria-label="Search (disabled)" />
        </label>
      </div>
    </footer>
  );
}
