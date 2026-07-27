import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, BackHandler, Platform, Linking } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "./src/theme";
import { getToken, setToken, whoami, listConversations, deleteConversation, ChatMessage, Conversation } from "./src/api";
import { SignIn } from "./src/SignIn";
import { Today } from "./src/Today";
import { Agent } from "./src/Agent";
import { Drawer, DrawerView } from "./src/Drawer";
import { Paywall } from "./src/Paywall";
import { reconcilePendingTransactions, watchTransactions } from "./src/iap";
import { PanelLeftIcon } from "./src/icons";

// Content height of the top bar (below the status-bar inset).
const TOPBAR_H = 50;

type Session = { key: string; convId: string | null; messages: ChatMessage[] };

function Shell() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<DrawerView>("today");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  // Set when any API call answers 402. Replaces the whole body with the paywall
  // so no screen can surface a raw "subscription required" string.
  const [blocked, setBlocked] = useState(false);

  // Agent conversation history — lives up here (like the web app) so the
  // drawer and the chat view share one state.
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [search, setSearch] = useState("");
  const nonce = useRef(0);
  const [session, setSession] = useState<Session>({ key: "new-0", convId: null, messages: [] });

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await listConversations());
    } catch {
      /* history is best-effort */
    }
  }, []);

  useEffect(() => {
    getToken().then((t) => {
      setAuthed(!!t);
      setReady(true);
    });
  }, []);

  // Deep-link session injection: `skcal://session?token=…` stores the token and
  // marks us signed in. Possessing a valid session token IS authentication, so
  // this opens no new hole — it exists so a headless simulator (which can't type
  // into the sign-in field) can be driven straight to the logged-in app.
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url) return;
      const m = url.match(/[?&]token=([^&]+)/);
      if (url.includes("session") && m) {
        setToken(decodeURIComponent(m[1])).then(() => setAuthed(true));
      }
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!authed) return;
    whoami().then((w) => setEmail(w.email)).catch(() => {});
    loadConversations();
  }, [authed, loadConversations]);

  // StoreKit renewals, refunds, and Ask-to-Buy approvals. Anything that lands
  // while the app is open gets pushed to /api/apple/verify immediately rather
  // than waiting on an App Store Server Notification round trip. Also sweeps up
  // transactions that were left unfinished by an earlier failed verify.
  useEffect(() => {
    if (!authed) return;
    reconcilePendingTransactions()
      .then((granted) => {
        if (granted) setBlocked(false);
      })
      .catch(() => {
        /* boot-time reconciliation is best-effort */
      });
    return watchTransactions((result) => {
      if (result.outcome === "active") setBlocked(false);
    });
  }, [authed]);

  // Android back: close the drawer / avatar menu before leaving the app.
  useEffect(() => {
    if (!drawerOpen && !menuOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setDrawerOpen(false);
      setMenuOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [drawerOpen, menuOpen]);

  const signOut = useCallback(async () => {
    setMenuOpen(false);
    setDrawerOpen(false);
    await setToken(null);
    setEmail(null);
    setConversations([]);
    setSession({ key: "new-0", convId: null, messages: [] });
    setView("today");
    setBlocked(false);
    setAuthed(false);
  }, []);

  const navigate = (v: DrawerView) => {
    setDrawerOpen(false);
    setView(v);
  };
  const newChat = () => {
    nonce.current += 1;
    setSession({ key: `new-${nonce.current}`, convId: null, messages: [] });
    navigate("coach");
  };
  const openConversation = (c: Conversation) => {
    setSession({ key: c.id, convId: c.id, messages: c.messages });
    navigate("coach");
  };
  const removeConversation = async (id: string) => {
    try {
      await deleteConversation(id);
    } catch {
      /* ignore */
    }
    if (session.convId === id) {
      nonce.current += 1;
      setSession({ key: `new-${nonce.current}`, convId: null, messages: [] });
    }
    loadConversations();
  };
  // First turn persisted server-side: adopt the id and refresh the list.
  const onPersisted = (id: string) => {
    setSession((s) => (s.convId ? s : { ...s, convId: id }));
    loadConversations();
  };

  if (!ready) return <View style={s.boot} />;
  if (!authed)
    return (
      <View style={s.boot}>
        <StatusBar style="light" />
        <SignIn onSignedIn={() => setAuthed(true)} />
      </View>
    );

  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.messages.some((m) => typeof m.content === "string" && m.content.toLowerCase().includes(q)),
      )
    : conversations;

  const onAuthError = async () => {
    await setToken(null);
    setAuthed(false);
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <View style={[s.topbar, { paddingTop: insets.top }]}>
        <Pressable style={s.iconBtn} onPress={() => setDrawerOpen(true)} accessibilityLabel="Menu">
          <PanelLeftIcon size={20} color={C.muted} />
        </Pressable>
        <Text style={s.topbarTitle}>{view === "coach" ? "Agent" : "Today"}</Text>
        <Pressable
          style={s.avatar}
          onPress={() => setMenuOpen((v) => !v)}
          accessibilityLabel="Account"
          accessibilityRole="button"
        >
          <Text style={s.avatarText}>{email?.[0]?.toUpperCase() ?? "·"}</Text>
        </Pressable>
      </View>

      <View style={s.body}>
        {blocked ? (
          <Paywall onActivated={() => setBlocked(false)} />
        ) : view === "today" ? (
          <Today onAuthError={onAuthError} onSubscriptionRequired={() => setBlocked(true)} />
        ) : (
          <Agent
            key={session.key}
            initialMessages={session.messages}
            initialConversationId={session.convId}
            onPersisted={onPersisted}
            keyboardOffset={Platform.OS === "ios" ? insets.top + TOPBAR_H : 0}
          />
        )}
      </View>

      {menuOpen && (
        <>
          <Pressable style={s.menuBackdrop} onPress={() => setMenuOpen(false)} accessibilityLabel="Close account menu" />
          <View style={[s.menu, { top: insets.top + TOPBAR_H - 4 }]}>
            <Text style={s.menuEmail}>{email ?? "…"}</Text>
            <Pressable style={s.menuItem} onPress={signOut}>
              <Text style={s.menuItemText}>Sign out</Text>
            </Pressable>
          </View>
        </>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        onNavigate={navigate}
        conversations={filtered}
        activeId={session.convId}
        search={search}
        onSearch={setSearch}
        onNewChat={newChat}
        onOpenConversation={openConversation}
        onDeleteConversation={removeConversation}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  boot: { flex: 1, backgroundColor: C.bg },
  root: { flex: 1, backgroundColor: C.bg },
  topbar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 10, backgroundColor: C.bg,
  },
  iconBtn: { width: 38, height: TOPBAR_H, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  topbarTitle: { flex: 1, color: C.fg, fontSize: 15.5, fontWeight: "600" },
  avatar: {
    width: 30, height: 30, borderRadius: 15, marginRight: 4,
    borderWidth: 1, borderColor: C.line, backgroundColor: "#26282b",
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: C.muted, fontFamily: "monospace", fontSize: 12, fontWeight: "600" },
  // Cap the reading width so iPad shows a centered column instead of a
  // phone layout stretched across 13 inches. No effect on phones.
  body: { flex: 1, width: "100%", maxWidth: 720, alignSelf: "center" },
  menuBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  menu: {
    position: "absolute", right: 10, minWidth: 210,
    backgroundColor: "#26282b", borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 6,
    shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 4, height: 4 }, elevation: 8,
  },
  menuEmail: {
    color: C.muted, fontFamily: "monospace", fontSize: 11,
    paddingHorizontal: 9, paddingTop: 7, paddingBottom: 9,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  menuItem: { marginTop: 5, paddingVertical: 10, paddingHorizontal: 9, borderRadius: 10 },
  menuItemText: { color: C.fg, fontSize: 14.5 },
});
