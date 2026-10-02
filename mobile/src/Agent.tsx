import { useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal, type TextStyle,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Markdown from "react-native-markdown-display";
import { makeStyles, useTheme, type Palette } from "./theme";
import { agentStream, photoSource, ChatMessage, ChatPart } from "./api";

// Persisted conversations may carry parts arrays (text + photos the web app
// uploaded to R2); flatten to display text for bubbles and titles.
const textOf = (m: ChatMessage): string =>
  typeof m.content === "string"
    ? m.content
    : m.content.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n");

function Bubble({ item }: { item: ChatMessage }) {
  const s = useS();
  const md = useMd();
  const user = item.role === "user";
  const parts = typeof item.content === "string" ? null : item.content;
  const text = textOf(item);
  return (
    <View style={[s.bubble, user ? s.user : s.assistant]}>
      {/* photos need the bearer header — the API serves them per-user */}
      {parts?.filter((p) => p.type === "image").map((p, i) => (
        <Image key={i} style={s.photo} source={photoSource(p.image)} resizeMode="cover" />
      ))}
      {/* user text is plain; assistant replies render markdown (bold, lists,
          links, code) so the raw ** and #'s from the model don't leak through */}
      {text ? (
        user ? <Text style={s.userText}>{text}</Text> : <Markdown style={md}>{text}</Markdown>
      ) : null}
    </View>
  );
}

// What the coach is doing while no reply text is streaming (mirrors the web
// app's tool chips).
const TOOL_LABELS: Record<string, string> = {
  list_food_log: "Reading food log",
  move_meal: "Moving meal",
  move_food_item: "Moving food",
  delete_meal: "Deleting meal",
  delete_food_item: "Deleting food",
  edit_food_item: "Fixing entry",
  log_meal: "Logging meal",
  log_measurement: "Logging measurement",
  log_weight: "Logging weight",
  log_workout: "Logging workout",
  query_user_data: "Looking through your data",
  get_weight_history: "Reading weight history",
  set_targets: "Updating targets",
  remember: "Saving to memory",
  forget_memory: "Forgetting",
  set_reminder: "Setting reminder",
  update_reminder: "Updating reminder",
  list_reminders: "Reading reminders",
  delete_reminder: "Deleting reminder",
};
const THINKING = "Thinking";

function Activity({ label }: { label: string }) {
  const s = useS();
  const { c } = useTheme();
  return (
    <View style={[s.bubble, s.assistant, s.activity]} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={c.muted} size="small" />
      <Text style={s.activityText}>{label}</Text>
    </View>
  );
}

// Picker result → data URL the worker's vision path accepts directly. The
// picker re-encodes what it returns as base64 (JPEG at quality < 1) but reports
// the original file's type, so the label comes from the bytes, not mimeType.
const imageTypeOf = (base64: string): string =>
  base64.startsWith("/9j/") ? "image/jpeg" : base64.startsWith("iVBORw0KGgo") ? "image/png" : base64.startsWith("R0lGOD") ? "image/gif" : base64.startsWith("UklGR") ? "image/webp" : "image/jpeg";
const toDataUrl = (a: ImagePicker.ImagePickerAsset): string | null => {
  if (a.uri.startsWith("data:")) return a.uri;
  if (a.base64) return `data:${imageTypeOf(a.base64)};base64,${a.base64}`;
  return null;
};

// Chrome's UA focus ring uses outline-style auto, which shrugs off a zero
// width — it has to be styled away. RNW supports outlineStyle; RN types don't.
const WEB_NO_RING = { outlineStyle: "none", outlineWidth: 0 } as unknown as TextStyle;

const PICKER_OPTS = {
  mediaTypes: ["images"] as ImagePicker.MediaType[],
  quality: 0.7,
  base64: true,
} as const;

// The live agent thread. Seeded from a saved conversation (or empty for a new
// chat); each completed turn persists to the shared conversation history so
// web and mobile see the same chats. The parent remounts it per session key.
export function Agent({
  initialMessages,
  initialConversationId,
  onPersisted,
  keyboardOffset,
}: {
  initialMessages: ChatMessage[];
  initialConversationId: string | null;
  onPersisted: (id: string) => void;
  keyboardOffset: number;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string[]>([]); // data URLs awaiting send
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  // Status shown under the thread while the coach works: "Thinking" until the
  // first token and between tool calls, a tool label while one runs, and
  // nothing while reply text streams in.
  const [activity, setActivity] = useState<string | null>(null);
  const s = useS();
  const { c } = useTheme();
  const list = useRef<FlatList<ChatMessage>>(null);
  const convIdRef = useRef<string | null>(initialConversationId);
  const insets = useSafeAreaInsets();

  const addAssets = (assets: ImagePicker.ImagePickerAsset[] | null | undefined) => {
    const urls = (assets ?? []).map(toDataUrl).filter((u): u is string => !!u);
    if (urls.length) setPending((p) => [...p, ...urls].slice(0, 4)); // worker caps 4/message
  };

  const pickLibrary = async () => {
    setSheetOpen(false);
    const res = await ImagePicker.launchImageLibraryAsync({ ...PICKER_OPTS, allowsMultipleSelection: true });
    if (!res.canceled) addAssets(res.assets);
  };

  const pickCamera = async () => {
    setSheetOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchCameraAsync(PICKER_OPTS);
    if (!res.canceled) addAssets(res.assets);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !pending.length) || busy) return;
    const photos = pending;
    const content: string | ChatPart[] = photos.length
      ? [...(text ? [{ type: "text" as const, text }] : []), ...photos.map((image) => ({ type: "image" as const, image }))]
      : text;
    const userMsg: ChatMessage = { role: "user", content };
    const next: ChatMessage[] = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setPending([]);
    setBusy(true);
    setActivity(THINKING);
    try {
      // The worker caps history at 20 messages; send the newest window,
      // opened on a user message (mirrors the web client).
      let window = next.slice(-20);
      while (window.length && window[0]?.role !== "user") window = window.slice(1);
      // Stream the reply token-by-token into a live assistant bubble; each
      // delta re-renders the markdown so the text builds up in place.
      // The worker saves the turn as it runs (a new chat gets its id in the
      // stream), so history is shared with the web app.
      const { reply, conversationId } = await agentStream(
        window,
        convIdRef.current,
        (full) => {
          setActivity(null);
          setMessages([...next, { role: "assistant", content: full }]);
        },
        (name, done) => setActivity(done ? THINKING : (TOOL_LABELS[name] ?? name)),
      );
      setActivity(null);
      setMessages([...next, { role: "assistant", content: reply }]);
      if (conversationId) {
        convIdRef.current = conversationId;
        onPersisted(conversationId);
      }
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `Something broke, try again. (${e instanceof Error ? e.message : e})` }]);
    } finally {
      setBusy(false);
      setActivity(null);
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const canSend = (input.trim().length > 0 || pending.length > 0) && !busy;

  return (
    // padding on Android too — the window doesn't resize under edge-to-edge,
    // so without it the keyboard covers the chat input (same bug as SignIn).
    <KeyboardAvoidingView
      style={s.wrap}
      behavior="padding"
      keyboardVerticalOffset={keyboardOffset}
    >
      <FlatList
        ref={list}
        style={s.list}
        contentContainerStyle={s.listContent}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => <Bubble item={item} />}
        ListEmptyComponent={<Text style={s.empty}>Ask before you eat.</Text>}
        ListFooterComponent={busy && activity ? <Activity label={activity} /> : null}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
      />
      {/* Mirrors the web composer: one pill — pending photo chips on top, the
          input full-width, then a controls row with attach bottom-left and
          send bottom-right. */}
      <View style={[s.composerWrap, { paddingBottom: 12 + insets.bottom }]}>
        <View style={[s.composer, focused && s.composerFocused]}>
          {pending.length > 0 && (
            <View style={s.chips}>
              {pending.map((uri, i) => (
                <View key={i} style={s.chip}>
                  <Image style={s.chipThumb} source={{ uri }} />
                  <Pressable
                    style={s.chipRemove}
                    onPress={() => setPending((p) => p.filter((_, j) => j !== i))}
                    accessibilityLabel="Remove photo"
                  >
                    <Text style={s.chipRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <TextInput
            style={[s.input, Platform.OS === "web" && WEB_NO_RING]}
            placeholder="What are you thinking of eating?"
            placeholderTextColor={c.muted}
            value={input}
            onChangeText={setInput}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            editable={!busy}
            multiline
          />
          <View style={s.controls}>
            <Pressable
              style={s.attach}
              onPress={() => setSheetOpen(true)}
              disabled={busy}
              accessibilityLabel="Add a photo"
            >
              <Text style={s.attachText}>+</Text>
            </Pressable>
            <Pressable style={[s.send, !canSend && s.sendDim]} onPress={send} disabled={!canSend}>
              {busy ? <ActivityIndicator color={c.amberInk} size="small" /> : <Text style={s.sendText}>↑</Text>}
            </Pressable>
          </View>
        </View>
      </View>

      {/* Two-option source sheet, same as the web composer's. */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSheetOpen(false)}
        supportedOrientations={["portrait", "landscape"]}
      >
        <Pressable style={s.sheetBackdrop} onPress={() => setSheetOpen(false)}>
          <Pressable
            style={[s.sheet, { paddingBottom: 12 + insets.bottom, marginLeft: insets.left, marginRight: insets.right }]}
            onPress={(e) => e.stopPropagation()}
          >
            {Platform.OS !== "web" && (
              <Pressable style={s.sheetOption} onPress={pickCamera}>
                <Text style={s.sheetOptionText}>Take photo</Text>
              </Pressable>
            )}
            <Pressable style={[s.sheetOption, Platform.OS !== "web" && s.sheetOptionBorder]} onPress={pickLibrary}>
              <Text style={s.sheetOptionText}>Photo library</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const useS = makeStyles((C: Palette) =>
  StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  list: { flex: 1 },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { color: C.muted, textAlign: "center", marginTop: 60, fontSize: 16 },
  bubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  user: { alignSelf: "flex-end", backgroundColor: C.amber, borderBottomRightRadius: 5 },
  assistant: { alignSelf: "flex-start", backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 5 },
  activity: { flexDirection: "row", alignItems: "center", gap: 8 },
  activityText: { color: C.muted, fontSize: 14 },
  userText: { color: C.amberInk, fontSize: 15.5, lineHeight: 21 },
  photo: { width: 180, height: 180, borderRadius: 12, backgroundColor: C.line },
  composerWrap: { padding: 12, borderTopWidth: 1, borderTopColor: C.line },
  composer: {
    borderWidth: 1, borderColor: C.line, borderRadius: 22, backgroundColor: C.card,
    paddingHorizontal: 8, paddingTop: 4, paddingBottom: 7,
  },
  composerFocused: { borderColor: C.amberText },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 6, paddingTop: 8 },
  chip: { position: "relative" },
  chipThumb: { width: 72, height: 72, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg },
  chipRemove: {
    position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center",
  },
  chipRemoveText: { color: "#fff", fontSize: 12, lineHeight: 14 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  input: {
    width: "100%", color: C.fg,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 15.5, maxHeight: 120,
  },
  attach: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.line,
    alignItems: "center", justifyContent: "center",
  },
  attachText: { color: C.muted, fontSize: 22, lineHeight: 24, fontWeight: "300" },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.amber, alignItems: "center", justifyContent: "center" },
  sendDim: { opacity: 0.4 },
  sendText: { color: C.amberInk, fontSize: 20, fontWeight: "800" },
  sheetBackdrop: { flex: 1, backgroundColor: C.scrim, justifyContent: "flex-end", alignItems: "center" },
  sheet: {
    width: "100%", maxWidth: 560,
    backgroundColor: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderWidth: 1, borderColor: C.line, paddingTop: 6, paddingHorizontal: 8,
  },
  sheetOption: { minHeight: 52, justifyContent: "center", paddingHorizontal: 14 },
  sheetOptionBorder: { borderTopWidth: 1, borderTopColor: C.line },
  sheetOptionText: { color: C.fg, fontSize: 16 },
  }),
);

// Themed markdown for assistant replies. body's text props (color, size,
// line height) cascade down to every text leaf via the renderer, matching the
// ~15.5px bubble text; only element-specific tweaks are overridden below.
const MONO = Platform.OS === "ios" ? "Menlo" : "monospace";
const useMd = makeStyles((C: Palette) =>
  StyleSheet.create({
  body: { color: C.fg, fontSize: 15.5, lineHeight: 21 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  strong: { fontWeight: "700", color: C.fg },
  em: { fontStyle: "italic" },
  link: { color: C.amberText, textDecorationLine: "underline" },
  heading1: { color: C.fg, fontSize: 20, fontWeight: "700", marginBottom: 6 },
  heading2: { color: C.fg, fontSize: 18, fontWeight: "700", marginBottom: 6 },
  heading3: { color: C.fg, fontSize: 16.5, fontWeight: "700", marginBottom: 4 },
  bullet_list: { marginBottom: 4 },
  ordered_list: { marginBottom: 4 },
  list_item: { marginBottom: 2 },
  hr: { backgroundColor: C.line, height: 1, marginVertical: 8 },
  blockquote: {
    backgroundColor: C.bg, borderLeftWidth: 3, borderLeftColor: C.line,
    borderColor: C.line, marginLeft: 0, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8,
  },
  code_inline: {
    backgroundColor: C.bg, color: C.fg, borderColor: C.line, borderWidth: 1,
    borderRadius: 4, paddingHorizontal: 4, fontFamily: MONO, fontSize: 14,
  },
  code_block: {
    backgroundColor: C.bg, color: C.fg, borderColor: C.line, borderWidth: 1,
    borderRadius: 8, padding: 10, fontFamily: MONO, fontSize: 14,
  },
  fence: {
    backgroundColor: C.bg, color: C.fg, borderColor: C.line, borderWidth: 1,
    borderRadius: 8, padding: 10, fontFamily: MONO, fontSize: 14,
  },
  table: { borderColor: C.line, borderRadius: 6 },
  tr: { borderColor: C.line },
  }),
);
