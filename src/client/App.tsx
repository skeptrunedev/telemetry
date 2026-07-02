import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { kgToLb } from "../shared/types";
import type { DashboardData } from "../shared/types";
import { api, todayLocal } from "./api";
import { Dashboard } from "./Dashboard";
import { AreaChart } from "./Chart";
import { AddSheet } from "./AddSheet";
import { BottomNav, type View } from "./BottomNav";
import { WeightHistory } from "./WeightHistory";
import { Coach } from "./Coach";
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
  if (s?.view === "trends" || s?.view === "today" || s?.view === "coach") return s.view;
  const hash = typeof location !== "undefined" ? location.hash : "";
  if (hash.includes("trends")) return "trends";
  if (hash.includes("coach")) return "coach";
  return "today";
}

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
      <WeightHistory />
    </div>
  );
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

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
      if (next === viewRef.current) return;
      history.replaceState({ view: viewRef.current, scroll: window.scrollY } satisfies HistoryState, "");
      history.pushState({ view: next, scroll: 0 } satisfies HistoryState, "", `#/${next}`);
      swapView(next, 0);
    },
    [swapView],
  );

  // Back/Forward: swap to the entry's view and restore its saved scroll.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = (e.state ?? null) as Partial<HistoryState> | null;
      const next: View =
        st?.view === "trends" || st?.view === "today" || st?.view === "coach" ? st.view : readView();
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
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Initial session check: hold a blank frame rather than flashing the sign-in
  // screen before we know whether there's a session.
  if (isPending) return <div className="app" />;
  // Signed out → the sign-in screen (Google + magic link).
  if (!email) return <SignIn />;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">skcal</span>
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
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={async () => {
                      setMenuOpen(false);
                      await signOut();
                      // Drop any signed-in view state and re-render the gate.
                      window.location.reload();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      <main className="shell">
        {error && <p className="form-err">{error}</p>}
        {!data && !error && <p className="meta">loading…</p>}
        {data && view === "today" && <Dashboard data={data} refreshKey={tick} onChange={reloadAll} />}
        {data && view === "trends" && <Trends data={data} />}
        {data && view === "coach" && <Coach />}
      </main>

      <BottomNav view={view} onChange={navigate} onAdd={() => setAdding(true)} />

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
