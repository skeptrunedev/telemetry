import { useEffect, useRef, useState } from "react";
import { Sun, MessageSquare, Plus, SquarePen, Search, PanelLeft, PanelLeftOpen, Trash2, ChevronDown, Plug } from "lucide-react";
import type { View } from "./BottomNav";
import type { CoachHistory } from "./Coach";
import { api } from "./api";
import { compressImage } from "./image";

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
    <button
      className={`nav-item ${active ? "active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={label}
    >
      <span className="nav-item-icon">{icon}</span>
      <span className="nav-item-label">{label}</span>
    </button>
  );
}

export function NavDrawer({
  view,
  onNavigate,
  onAdd,
  open,
  onClose,
  onExpand,
  email,
  avatar,
  onAvatarChange,
  onSignOut,
  onInstallMcp,
  onApiKeys,
  onLinkedNumbers,
  onBilling,
  coach,
}: {
  view: View;
  onNavigate: (v: View) => void;
  onAdd: () => void;
  open: boolean;
  onClose: () => void;
  onExpand: () => void;
  email: string;
  avatar: string | null;
  onAvatarChange: (image: string) => void;
  onSignOut: () => void;
  onInstallMcp: () => void;
  onApiKeys: () => void;
  onLinkedNumbers: () => void;
  // null hides the item (billing-exempt accounts).
  onBilling: (() => void) | null;
  coach: CoachHistory;
}) {
  const [profileMenu, setProfileMenu] = useState(false);
  const [uploading, setUploading] = useState(false);
  const footRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { image } = await api.setAvatar(await compressImage(file));
      onAvatarChange(image);
      setProfileMenu(false);
    } catch {
      /* ignore — keep the current avatar */
    } finally {
      setUploading(false);
    }
  }

  // Close the profile menu when clicking/tapping anywhere outside it.
  useEffect(() => {
    if (!profileMenu) return;
    const onDown = (e: PointerEvent) => {
      if (footRef.current && !footRef.current.contains(e.target as Node)) setProfileMenu(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [profileMenu]);

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
          <span className="sidebar-brand">
            <img className="sidebar-brand-mark" src="/brand-mark.svg" alt="" width={22} height={22} />
            skcal
          </span>
          <button className="nav-icon-btn sidebar-close" onClick={onClose} aria-label="Collapse sidebar">
            <PanelLeft />
          </button>
          {/* Collapsed rail (desktop): the brand mark doubles as the expand
              control — it swaps to a panel-open icon on hover/focus. */}
          <button className="nav-icon-btn sidebar-expand" onClick={onExpand} aria-label="Expand sidebar">
            <img className="sidebar-expand-logo" src="/brand-mark.svg" alt="" width={22} height={22} />
            <PanelLeftOpen className="sidebar-expand-icon" />
          </button>
        </div>

        <nav className="nav-items">
          <NavItem icon={NAV_ICONS.today} label="Today" active={view === "today"} onClick={() => onNavigate("today")} />
          <NavItem icon={NAV_ICONS.coach} label="Agent" active={view === "coach"} onClick={() => onNavigate("coach")} />
          <NavItem icon={NAV_ICONS.add} label="Log entry" onClick={onAdd} />
          <NavItem icon={<Plug />} label="Install MCP" onClick={onInstallMcp} />
        </nav>

        <div className="sidebar-divider" />

        <button className="nav-item" onClick={goCoachNew} title="New chat">
          <span className="nav-item-icon">
            <SquarePen />
          </span>
          <span className="nav-item-label">New chat</span>
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

        <div className="sidebar-foot" ref={footRef}>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickAvatar} />
          {profileMenu && (
            <div className="profile-menu" role="menu">
              <button
                className="profile-menu-item"
                role="menuitem"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : avatar ? "Change photo" : "Add photo"}
              </button>
              <button
                className="profile-menu-item"
                role="menuitem"
                onClick={() => {
                  setProfileMenu(false);
                  onApiKeys();
                }}
              >
                API keys
              </button>
              <button
                className="profile-menu-item"
                role="menuitem"
                onClick={() => {
                  setProfileMenu(false);
                  onLinkedNumbers();
                }}
              >
                Linked numbers
              </button>
              {onBilling && (
                <button
                  className="profile-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setProfileMenu(false);
                    onBilling();
                  }}
                >
                  Billing
                </button>
              )}
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
            <span className="profile-avatar">
              {avatar ? <img src={avatar} alt="" /> : email[0]?.toUpperCase()}
            </span>
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
