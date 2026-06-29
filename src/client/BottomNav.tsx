import type { ReactNode } from "react";

export type View = "today" | "trends" | "photos";

const ICONS: Record<View, ReactNode> = {
  today: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </svg>
  ),
  trends: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l5-6 4 4 8-9" />
    </svg>
  ),
  photos: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M21 17l-5-5-4 4" />
    </svg>
  ),
};

const LABELS: Record<View, string> = { today: "Today", trends: "Trends", photos: "Photos" };

export function BottomNav({
  view,
  onChange,
  onAdd,
}: {
  view: View;
  onChange: (v: View) => void;
  onAdd: () => void;
}) {
  return (
    <div className="dock">
      <nav className="nav">
        {(Object.keys(LABELS) as View[]).map((v) => (
          <button
            key={v}
            className={`nav-btn ${view === v ? "active" : ""}`}
            onClick={() => onChange(v)}
            aria-current={view === v}
          >
            {ICONS[v]}
            <span>{LABELS[v]}</span>
          </button>
        ))}
      </nav>
      <button className="fab" aria-label="Add entry" onClick={onAdd}>
        +
      </button>
    </div>
  );
}
