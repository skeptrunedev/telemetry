import { useState } from "react";
import type { View } from "./BottomNav";
import type { CoachHistory } from "./Coach";

const ICONS: Record<View | "add", React.ReactNode> = {
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
  coach: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16v11H8l-4 4V5z" />
    </svg>
  ),
  add: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
};

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span className="nav-item-icon">{icon}</span>
      {label}
    </button>
  );
}

export function NavDrawer({
  view,
  onNavigate,
  onAdd,
  open,
  onClose,
  email,
  onSignOut,
  coach,
}: {
  view: View;
  onNavigate: (v: View) => void;
  onAdd: () => void;
  open: boolean;
  onClose: () => void;
  email: string;
  onSignOut: () => void;
  coach: CoachHistory;
}) {
  const [profileMenu, setProfileMenu] = useState(false);

  const goCoachNew = () => {
    coach.newChat();
    onNavigate("coach");
  };
  const openConv = (c: CoachHistory["conversations"][number]) => {
    coach.openConversation(c);
    onNavigate("coach");
  };

  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
      <aside className={`app-sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-head">
          <button className="nav-icon-btn sidebar-close" onClick={onClose} aria-label="Close menu">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        <nav className="nav-items">
          <NavItem icon={ICONS.today} label="Today" active={view === "today"} onClick={() => onNavigate("today")} />
          <NavItem icon={ICONS.trends} label="Trends" active={view === "trends"} onClick={() => onNavigate("trends")} />
          <NavItem icon={ICONS.coach} label="Coach" active={view === "coach"} onClick={() => onNavigate("coach")} />
          <NavItem icon={ICONS.add} label="Log entry" onClick={onAdd} />
        </nav>

        <div className="sidebar-divider" />

        <button className="nav-item nav-newchat" onClick={goCoachNew}>
          <span className="nav-item-icon">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M10 4v12M4 10h12" />
            </svg>
          </span>
          New chat
        </button>
        <input
          className="coach-search"
          placeholder="Search chats"
          value={coach.search}
          onChange={(e) => coach.setSearch(e.target.value)}
        />
        <div className="coach-recents-label">Recents</div>
        <nav className="coach-recents">
          {coach.conversations.length === 0 && (
            <p className="meta coach-empty-list">{coach.hasQuery ? "No matches" : "No conversations yet"}</p>
          )}
          {coach.conversations.map((c) => (
            <div key={c.id} className={`coach-recent ${coach.activeId === c.id ? "active" : ""}`}>
              <button className="coach-recent-title" onClick={() => openConv(c)} title={c.title}>
                {c.title}
              </button>
              <button
                className="nav-icon-btn coach-recent-del"
                onClick={() => coach.removeConversation(c.id)}
                aria-label="Delete conversation"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L15 6" />
                </svg>
              </button>
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          {profileMenu && (
            <div className="profile-menu" role="menu">
              <button
                className="profile-menu-item"
                role="menuitem"
                onClick={() => {
                  setProfileMenu(false);
                  onSignOut();
                }}
              >
                Sign out
              </button>
            </div>
          )}
          <button
            className="profile-row"
            onClick={() => setProfileMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={profileMenu}
          >
            <span className="profile-avatar">{email[0]?.toUpperCase()}</span>
            <span className="profile-email" title={email}>
              {email}
            </span>
            <svg className="profile-caret" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8l4 4 4-4" />
            </svg>
          </button>
        </div>
      </aside>
    </>
  );
}
