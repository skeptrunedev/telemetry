import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { PanelLeft, Plus } from "lucide-react";
import type { DashboardData } from "../shared/types";
import { api, todayLocal } from "./api";
import { Dashboard } from "./Dashboard";
import { AddSheet } from "./AddSheet";
import { type View } from "./BottomNav";
import { NavDrawer } from "./NavDrawer";
import { useCoachHistory, CoachThread } from "./Coach";
import { SignIn } from "./SignIn";
import { useSession, signOut } from "./auth-client";

// We own scroll position per history entry, so stop the browser from guessing.
if (typeof history !== "undefined" && "scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}
const REDUCE_MOTION =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

type HistoryState = { view: View; scroll: number };

// Cross-fade a view swap with the View Transitions API; instant swap when
// unsupported or reduced motion is requested. `apply` must mutate the DOM
// synchronously (we flushSync inside it), so the transition captures it.
function viewTransition(apply: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (REDUCE_MOTION || typeof doc.startViewTransition !== "function") {
    apply();
    return;
  }
  doc.startViewTransition(apply);
}

// Re-apply a target scroll across a few frames: async content (e.g. the food
// log) can grow the page right after a view swap, so a single scrollTo would
// clamp short. Stop once we reach it or after ~650ms.
function restoreScroll(y: number) {
  if (y <= 0) {
    window.scrollTo(0, 0);
    return;
  }
  let tries = 0;
  const tick = () => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) > 1 && ++tries < 40) requestAnimationFrame(tick);
  };
  tick();
}

// True when the most recent weigh-in falls on today (local date). The trend is
// raw readings in ascending time order, so the last point is the latest.
function weightLoggedToday(data: DashboardData | null): boolean {
  const last = data?.weight.trend.at(-1);
  if (!last) return false;
  return new Date(last.ts).toLocaleDateString("en-CA") === todayLocal();
}

function readView(): View {
  const s = (typeof history !== "undefined" ? history.state : null) as Partial<HistoryState> | null;
  if (s?.view === "today" || s?.view === "coach") return s.view;
  const path = typeof location !== "undefined" ? location.pathname : "/";
  if (path.startsWith("/agent")) return "coach";
  return "today";
}

// Real URL path for a view (root is Today; the coach view is branded "agent").
const viewPath = (v: View) => (v === "coach" ? "/agent" : "/");

export default function App() {
  // Better Auth session gates the whole app: signed out → the sign-in screen,
  // signed in → the tracker. `isPending` is the initial session fetch.
  const { data: session, isPending } = useSession();
  const email = session?.user?.email ?? null;

  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(readView);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Desktop: whether the persistent sidebar is collapsed (remembered).
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem("skcal-nav-collapsed") === "1");
  const coach = useCoachHistory();
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    localStorage.setItem("skcal-nav-collapsed", navCollapsed ? "1" : "0");
  }, [navCollapsed]);

  // Cross-fade to a view and land at `scroll` (re-applying as content settles).
  const swapView = useCallback((next: View, scroll: number) => {
    viewTransition(() => {
      flushSync(() => setView(next));
      window.scrollTo(0, scroll);
    });
    if (scroll > 0) restoreScroll(scroll);
  }, []);

  // Navigate between views: push a history entry (so Back/Forward work),
  // remember where we were scrolled, cross-fade, and start the new view at top.
  const navigate = useCallback(
    (next: View) => {
      setDrawerOpen(false);
      if (next === viewRef.current) return;
      history.replaceState({ view: viewRef.current, scroll: window.scrollY } satisfies HistoryState, "");
      history.pushState({ view: next, scroll: 0 } satisfies HistoryState, "", viewPath(next));
      swapView(next, 0);
    },
    [swapView],
  );

  // Back/Forward: swap to the entry's view and restore its saved scroll.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = (e.state ?? null) as Partial<HistoryState> | null;
      const next: View =
        st?.view === "today" || st?.view === "coach" ? st.view : readView();
      swapView(next, st?.scroll ?? 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [swapView]);

  // Seed the first entry, then keep its scroll up to date as the user scrolls.
  useEffect(() => {
    const cur = (history.state ?? null) as Partial<HistoryState> | null;
    if (cur?.view == null) history.replaceState({ view: viewRef.current, scroll: 0 } satisfies HistoryState, "");
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const st = (history.state ?? {}) as Partial<HistoryState>;
        history.replaceState({ view: st.view ?? viewRef.current, scroll: window.scrollY } satisfies HistoryState, "");
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

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

  // Only load the dashboard once we have a signed-in identity.
  useEffect(() => {
    if (email) load();
  }, [email, load]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Initial session check: hold a blank frame rather than flashing the sign-in
  // screen before we know whether there's a session.
  if (isPending) return <div className="app" />;
  // Signed out → the sign-in screen (Google + magic link).
  if (!email) return <SignIn />;

  const signOutAndReload = async () => {
    await signOut();
    // Drop any signed-in view state and re-render the gate.
    window.location.reload();
  };

  return (
    <div className={`app ${navCollapsed ? "nav-collapsed" : ""}`}>
      <NavDrawer
        view={view}
        onNavigate={navigate}
        onAdd={() => {
          setDrawerOpen(false);
          setAdding(true);
        }}
        open={drawerOpen}
        // Mobile: close the drawer. Desktop: collapse the persistent sidebar.
        onClose={() => {
          setDrawerOpen(false);
          setNavCollapsed(true);
        }}
        email={email}
        onSignOut={signOutAndReload}
        coach={coach}
      />

      <div className="app-body">
        <header className="topbar">
          <button
            className="nav-icon-btn topbar-menu"
            onClick={() => {
              setNavCollapsed(false);
              setDrawerOpen(true);
            }}
            aria-label="Menu"
          >
            <PanelLeft />
          </button>
          <span className="topbar-title">{view === "coach" ? "Agent" : "Today"}</span>
          {view === "today" && (
            <button className="nav-icon-btn topbar-add" onClick={() => setAdding(true)} aria-label="Log entry">
              <Plus />
            </button>
          )}
        </header>

        <main className={`shell ${view === "coach" ? "shell-coach" : ""}`}>
          {error && <p className="form-err">{error}</p>}
          {!data && !error && <p className="meta">loading…</p>}
          {data && view === "today" && <Dashboard data={data} refreshKey={tick} onChange={reloadAll} />}
          {data && view === "coach" && (
            <CoachThread
              key={coach.session.key}
              initialMessages={coach.session.messages}
              initialConversationId={coach.session.convId}
              onPersisted={coach.onPersisted}
            />
          )}
        </main>
      </div>

      {adding && (
        <AddSheet
          onClose={() => setAdding(false)}
          onChange={reloadAll}
          // If today's weigh-in is already logged, open straight to nutrition.
          defaultTab={weightLoggedToday(data) ? "nutrition" : "weight"}
        />
      )}
    </div>
  );
}
