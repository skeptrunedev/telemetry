import type { ReactNode } from "react";

export type View = "today" | "trends" | "photos";

const TODAY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
  </svg>
);
const TRENDS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l5-6 4 4 8-9" />
  </svg>
);
const PHOTOS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2" />
    <path d="M21 17l-5-5-4 4" />
  </svg>
);
const ADD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

function Tab({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-btn ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

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
    <nav className="nav" aria-label="Primary">
      <Tab icon={TODAY_ICON} label="Today" active={view === "today"} onClick={() => onChange("today")} />
      <Tab icon={TRENDS_ICON} label="Trends" active={view === "trends"} onClick={() => onChange("trends")} />
      <button className="nav-btn nav-add" onClick={onAdd} aria-label="Add entry">
        {ADD_ICON}
        <span>Add</span>
      </button>
      <Tab icon={PHOTOS_ICON} label="Photos" active={view === "photos"} onClick={() => onChange("photos")} />
    </nav>
  );
}
