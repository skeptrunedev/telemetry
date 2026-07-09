import { useEffect, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
  Animated, Easing, Alert, Dimensions, AccessibilityInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "./theme";
import { Conversation } from "./api";
import { SunIcon, MessageSquareIcon, SquarePenIcon, SearchIcon, TrashIcon } from "./icons";

export type DrawerView = "today" | "coach";

const DRAWER_W = Math.min(Dimensions.get("window").width * 0.84, 320);

// "3m" / "2h" / "5d" ago, matching a compact recents list.
function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(ts).toLocaleDateString();
}

function NavItem({ icon, label, active, onPress }: { icon: React.ReactNode; label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable style={[s.navItem, active && s.navItemActive]} onPress={onPress} accessibilityRole="button">
      <View style={s.navItemIcon}>{icon}</View>
      <Text style={s.navItemLabel}>{label}</Text>
    </Pressable>
  );
}

// Left slide-in drawer over a dim scrim — the mobile web app's NavDrawer:
// brand header, nav links, then the agent history (new chat / search / recents).
export function Drawer({
  open,
  onClose,
  view,
  onNavigate,
  conversations,
  activeId,
  search,
  onSearch,
  onNewChat,
  onOpenConversation,
  onDeleteConversation,
}: {
  open: boolean;
  onClose: () => void;
  view: DrawerView;
  onNavigate: (v: DrawerView) => void;
  conversations: Conversation[];
  activeId: string | null;
  search: string;
  onSearch: (q: string) => void;
  onNewChat: () => void;
  onOpenConversation: (c: Conversation) => void;
  onDeleteConversation: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  // Keep mounted through the slide-out so the close animation plays.
  const [shown, setShown] = useState(open);
  const reduceMotion = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => (reduceMotion.current = v)).catch(() => {});
  }, []);

  useEffect(() => {
    if (open) setShown(true);
    const anim = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: reduceMotion.current ? 0 : 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !open) setShown(false);
    });
    return () => anim.stop();
  }, [open, progress]);

  if (!shown) return null;

  const confirmDelete = (c: Conversation) =>
    Alert.alert("Delete conversation?", c.title, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => onDeleteConversation(c.id) },
    ]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "auto" : "none"}>
      <Animated.View style={[s.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View
        style={[
          s.drawer,
          {
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 8,
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-DRAWER_W, 0] }) }],
          },
        ]}
      >
        <View style={s.head}>
          <Text style={s.brand}>skcal</Text>
        </View>

        <NavItem
          icon={<SunIcon size={19} color={view === "today" ? C.amber : C.muted} />}
          label="Today"
          active={view === "today"}
          onPress={() => onNavigate("today")}
        />
        <NavItem
          icon={<MessageSquareIcon size={19} color={view === "coach" ? C.amber : C.muted} />}
          label="Agent"
          active={view === "coach"}
          onPress={() => onNavigate("coach")}
        />

        <View style={s.divider} />

        <NavItem icon={<SquarePenIcon size={19} color={C.muted} />} label="New chat" onPress={onNewChat} />
        <View style={s.searchWrap}>
          <View style={s.searchIcon}>
            <SearchIcon size={15} color={C.muted} />
          </View>
          <TextInput
            style={s.search}
            placeholder="Search chats"
            placeholderTextColor={C.muted}
            value={search}
            onChangeText={onSearch}
          />
        </View>
        <Text style={s.recentsLabel}>RECENTS</Text>
        <ScrollView style={s.recents} contentContainerStyle={s.recentsContent}>
          {conversations.length === 0 && (
            <Text style={s.empty}>{search.trim() ? "No matches" : "No conversations yet"}</Text>
          )}
          {conversations.map((c) => (
            <View key={c.id} style={[s.recent, activeId === c.id && s.recentActive]}>
              <Pressable
                style={s.recentBtn}
                onPress={() => onOpenConversation(c)}
                onLongPress={() => confirmDelete(c)}
              >
                <Text style={s.recentTitle} numberOfLines={1}>{c.title}</Text>
                <Text style={s.recentTime}>{relTime(c.updatedAt)}</Text>
              </Pressable>
              <Pressable style={s.recentDel} onPress={() => confirmDelete(c)} accessibilityLabel="Delete conversation">
                <TrashIcon size={15} color={C.muted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)" },
  drawer: {
    position: "absolute", top: 0, bottom: 0, left: 0, width: DRAWER_W,
    backgroundColor: C.bg, paddingHorizontal: 10,
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "rgba(255,255,255,0.07)",
  },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 8 },
  brand: { color: C.fg, fontFamily: "monospace", letterSpacing: 3, fontSize: 14, fontWeight: "700" },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 9 },
  navItemActive: { backgroundColor: "rgba(255,255,255,0.1)" },
  navItemIcon: { width: 20, alignItems: "center" },
  navItemLabel: { color: C.fg, fontSize: 15 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 8, marginHorizontal: 3 },
  searchWrap: { position: "relative", justifyContent: "center", marginTop: 2 },
  searchIcon: { position: "absolute", left: 11, zIndex: 1 },
  search: {
    backgroundColor: "#1a1c1e", borderWidth: 1, borderColor: C.line, borderRadius: 10,
    color: C.fg, fontSize: 14.5, paddingVertical: 8, paddingLeft: 34, paddingRight: 12,
  },
  recentsLabel: { color: C.muted, fontFamily: "monospace", fontSize: 10, letterSpacing: 1, marginTop: 12, marginBottom: 2, paddingHorizontal: 4 },
  recents: { flex: 1 },
  recentsContent: { gap: 1 },
  empty: { color: C.muted, fontSize: 13, padding: 6 },
  recent: { flexDirection: "row", alignItems: "center", borderRadius: 8 },
  recentActive: { backgroundColor: "rgba(255,255,255,0.08)" },
  recentBtn: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, paddingHorizontal: 8 },
  recentTitle: { flex: 1, color: C.fg, fontSize: 14 },
  recentTime: { color: C.muted, fontFamily: "monospace", fontSize: 11 },
  recentDel: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
