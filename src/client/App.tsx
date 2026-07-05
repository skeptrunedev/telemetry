import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { PanelLeft, Plus } from "lucide-react";
import type { DashboardData } from "../shared/types";
import { api, todayLocal } from "./api";
import { Dashboard } from "./Dashboard";
import { AddSheet } from "./AddSheet";
import { type View } from "./BottomNav";
import { NavDrawer } from "./NavDrawer";
import { McpInstall } from "./McpInstall";
import { ApiKeys } from "./ApiKeys";
import { LinkedNumbers } from "./LinkedNumbers";
import { Subscribe } from "./Subscribe";
import type { Billing } from "./api";
import { useCoachHistory, CoachThread, type CoachHistory } from "./Coach";
import type { CoachConversation } from "./api";
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
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready?: Promise<void>; finished?: Promise<void> };
  };
  if (REDUCE_MOTION || typeof doc.startViewTransition !== "function") {
    apply();
    return;
  }
  // A rapid second navigation (e.g. Back then Forward) skips the in-flight
  // transition, rejecting these promises with a benign AbortError — swallow it.
  const t = doc.startViewTransition(apply);
  t?.ready?.catch(() => {});
  t?.finished?.catch(() => {});
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
// An open conversation is addressable at /agent/c/:id so refresh/deep links
// land back in it.
const viewPath = (v: View, convId: string | null = null) =>
  v === "coach" ? (convId ? `/agent/c/${encodeURIComponent(convId)}` : "/agent") : "/";

const convIdFromPath = (path: string): string | null => {
  const m = /^\/agent\/c\/([^/]+)/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
};

export default function App() {
  // Better Auth session gates the whole app: signed out → the sign-in screen,
  // signed in → the tracker. `isPending` is the initial session fetch.
  const { data: session, isPending } = useSession();
  const email = session?.user?.email ?? null;
  // Session carries the profile image (Gravatar/Google/uploaded); override it
  // locally after an upload so the new avatar shows without a session refetch.
  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);
  const avatar = avatarOverride ?? session?.user?.image ?? null;

  const [data, setData] = useState<DashboardData | null>(null);
  // The day everything on Today reflects (weight, nutrition, food log).
  const [day, setDay] = useState(() => todayLocal());
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(readView);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [numbersOpen, setNumbersOpen] = useState(false);
  // Subscription state (null while loading). Non-active blocks the app with the
  // Subscribe screen; a ?billing=success return from Stripe forces a refetch.
  const [billing, setBilling] = useState<Billing | null>(null);
  useEffect(() => {
    if (!email) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("billing")) {
      params.delete("billing");
      const qs = params.toString();
      history.replaceState(history.state, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
    // Fail open on a fetch error so a transient blip never locks the app.
    api
      .billing()
      .then(setBilling)
      .catch(() => setBilling({ active: true, exempt: false, status: null, periodEnd: null, priceUsd: 100 }));
  }, [email]);
  // Desktop: whether the persistent sidebar is collapsed (remembered).
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem("skcal-nav-collapsed") === "1");
  const coach = useCoachHistory();
  const viewRef = useRef(view);
  viewRef.current = view;

  // Conversation id the URL currently reflects. A ref (not state): `navigate`
  // and the popstate handler need the fresh value before React re-renders the
  // new coach session.
  const urlConvIdRef = useRef<string | null>(convIdFromPath(location.pathname));

  // Push a history entry for a conversation switch while already on the coach
  // view (cross-view swaps get their URL from `navigate` instead).
  const pushConvUrl = useCallback(() => {
    const url = viewPath("coach", urlConvIdRef.current);
    if (location.pathname === url) return;
    history.replaceState({ view: "coach", scroll: window.scrollY } satisfies HistoryState, "");
    history.pushState({ view: "coach", scroll: 0 } satisfies HistoryState, "", url);
  }, []);

  // Coach handlers wrapped with URL upkeep (the hook itself stays URL-free).
  const openConversation = useCallback(
    (conv: CoachConversation) => {
      urlConvIdRef.current = conv.id;
      coach.openConversation(conv);
      if (viewRef.current === "coach") pushConvUrl();
    },
    [coach.openConversation, pushConvUrl],
  );
  const newChat = useCallback(() => {
    urlConvIdRef.current = null;
    coach.newChat();
    if (viewRef.current === "coach") pushConvUrl();
  }, [coach.newChat, pushConvUrl]);
  // First turn persisted: the session gained an id — reflect it in the URL
  // without adding a history entry mid-conversation.
  const onPersisted = useCallback(
    (id: string) => {
      coach.onPersisted(id);
      if (urlConvIdRef.current == null && viewRef.current === "coach") {
        urlConvIdRef.current = id;
        history.replaceState(history.state, "", viewPath("coach", id));
      }
    },
    [coach.onPersisted],
  );
  const removeConversation = useCallback(
    async (id: string) => {
      await coach.removeConversation(id);
      // Deleting the open conversation resets the session to a fresh chat;
      // rewrite (not push) the URL to match.
      if (urlConvIdRef.current === id) {
        urlConvIdRef.current = null;
        if (viewRef.current === "coach") history.replaceState(history.state, "", viewPath("coach"));
      }
    },
    [coach.removeConversation],
  );
  const coachNav: CoachHistory = { ...coach, openConversation, newChat, onPersisted, removeConversation };

  // Deep link (/agent/c/:id on load): open that conversation once the list
  // arrives; a bad/foreign id falls back to the fresh chat and a clean /agent
  // URL. Skipped if the user already started chatting.
  useEffect(() => {
    const id = urlConvIdRef.current;
    if (!coach.loaded || !id || coach.session.convId) return;
    if (!coach.openById(id)) {
      urlConvIdRef.current = null;
      history.replaceState(history.state, "", viewPath("coach"));
    }
  }, [coach.loaded, coach.openById, coach.session.convId]);

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
      history.pushState({ view: next, scroll: 0 } satisfies HistoryState, "", viewPath(next, urlConvIdRef.current));
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
      // Best-effort: sync the open conversation to what the URL points at
      // (plain /agent, or an id no longer in the list, means a fresh chat).
      const id = convIdFromPath(location.pathname);
      if (next === "coach" && id !== urlConvIdRef.current) {
        urlConvIdRef.current = id;
        if (!id || !coach.openById(id)) coach.newChat();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [swapView, coach.openById, coach.newChat]);

  // Seed the first entry, then keep its scroll up to date as the user scrolls.
  useEffect(() => {
    // We restore scroll ourselves on Back/Forward; the browser's native restore
    // fires against the OLD view's DOM (clamping to 0) and its scroll event
    // would clobber the entry's saved position before we read it.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const cur = (history.state ?? null) as Partial<HistoryState> | null;
    if (cur?.view == null) history.replaceState({ view: viewRef.current, scroll: 0 } satisfies HistoryState, "");
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const st = (history.state ?? {}) as Partial<HistoryState>;
        // Only record scroll for the view that's actually on screen — during a
        // swap, stray scroll events must not overwrite another entry's memory.
        if (st.view != null && st.view !== viewRef.current) return;
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
      .dashboard(day)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [day]);

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

  // Signed in but not subscribed → the paywall (hold blank while loading).
  if (billing === null) return <div className="app" />;
  if (!billing.active) return <Subscribe billing={billing} email={email} onSignOut={signOutAndReload} />;

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
        onExpand={() => setNavCollapsed(false)}
        email={email}
        avatar={avatar}
        onAvatarChange={setAvatarOverride}
        onSignOut={signOutAndReload}
        onInstallMcp={() => {
          setDrawerOpen(false);
          setMcpOpen(true);
        }}
        onApiKeys={() => {
          setDrawerOpen(false);
          setKeysOpen(true);
        }}
        onLinkedNumbers={() => {
          setDrawerOpen(false);
          setNumbersOpen(true);
        }}
        onBilling={
          billing.exempt
            ? null
            : async () => {
                setDrawerOpen(false);
                try {
                  const { url } = await api.billingPortal();
                  window.location.href = url;
                } catch {
                  const { url } = await api.billingCheckout().catch(() => ({ url: "" }));
                  if (url) window.location.href = url;
                }
              }
        }
        coach={coachNav}
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
          {data && view === "today" && <Dashboard data={data} date={day} onDateChange={setDay} refreshKey={tick} onChange={reloadAll} />}
          {data && view === "coach" && (
            <CoachThread
              key={coach.session.key}
              initialMessages={coach.session.messages}
              initialConversationId={coach.session.convId}
              onPersisted={onPersisted}
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

      {mcpOpen && <McpInstall onClose={() => setMcpOpen(false)} />}
      {keysOpen && <ApiKeys onClose={() => setKeysOpen(false)} />}
      {numbersOpen && <LinkedNumbers onClose={() => setNumbersOpen(false)} />}
    </div>
  );
}
