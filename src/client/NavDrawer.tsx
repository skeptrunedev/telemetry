import { useState } from "react";
import { Sun, MessageSquare, Plus, SquarePen, Search, PanelLeft, Trash2, ChevronDown } from "lucide-react";
import type { View } from "./BottomNav";
import type { CoachHistory } from "./Coach";

const NAV_ICONS: Record<View | "add", React.ReactNode> = {
  today: <Sun />,
  coach: <MessageSquare />,
  add: <Plus />,
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
          <button className="nav-icon-btn sidebar-close" onClick={onClose} aria-label="Collapse sidebar">
            <PanelLeft />
          </button>
        </div>

        <nav className="nav-items">
          <NavItem icon={NAV_ICONS.today} label="Today" active={view === "today"} onClick={() => onNavigate("today")} />
          <NavItem icon={NAV_ICONS.coach} label="Coach" active={view === "coach"} onClick={() => onNavigate("coach")} />
          <NavItem icon={NAV_ICONS.add} label="Log entry" onClick={onAdd} />
        </nav>

        <div className="sidebar-divider" />

        <button className="nav-item" onClick={goCoachNew}>
          <span className="nav-item-icon">
            <SquarePen />
          </span>
          New chat
        </button>
        <div className="coach-search-wrap">
          <Search className="coach-search-icon" />
          <input
            className="coach-search"
            placeholder="Search chats"
            value={coach.search}
            onChange={(e) => coach.setSearch(e.target.value)}
          />
        </div>
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
                <Trash2 />
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
            <ChevronDown className="profile-caret" />
          </button>
        </div>
      </aside>
    </>
  );
}
