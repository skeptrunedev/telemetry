import { useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "./theme";
import { agent, createConversation, appendMessages, photoSource, ChatMessage } from "./api";

// Persisted conversations may carry parts arrays (text + photos the web app
// uploaded to R2); flatten to display text for bubbles and titles.
const textOf = (m: ChatMessage): string =>
  typeof m.content === "string"
    ? m.content
    : m.content.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n");

function Bubble({ item }: { item: ChatMessage }) {
  const user = item.role === "user";
  const parts = typeof item.content === "string" ? null : item.content;
  return (
    <View style={[s.bubble, user ? s.user : s.assistant]}>
      {/* photos need the bearer header — the API serves them per-user */}
      {parts?.filter((p) => p.type === "image").map((p, i) => (
        <Image key={i} style={s.photo} source={photoSource(p.image)} resizeMode="cover" />
      ))}
      {textOf(item) ? <Text style={user ? s.userText : s.assistantText}>{textOf(item)}</Text> : null}
    </View>
  );
}

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
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<ChatMessage>>(null);
  const convIdRef = useRef<string | null>(initialConversationId);
  const insets = useSafeAreaInsets();

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    const next: ChatMessage[] = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      // The worker caps history at 20 messages; send the newest window,
      // opened on a user message (mirrors the web client).
      let window = next.slice(-20);
      while (window.length && window[0]?.role !== "user") window = window.slice(1);
      const reply = await agent(window);
      setMessages([...next, { role: "assistant", content: reply }]);
      // Persist the completed turn exactly like the web app so history is shared.
      const turn: ChatMessage[] = [userMsg, { role: "assistant", content: reply }];
      try {
        if (!convIdRef.current) {
          const { id } = await createConversation(text, turn);
          convIdRef.current = id;
        } else {
          await appendMessages(convIdRef.current, turn);
        }
        onPersisted(convIdRef.current);
      } catch {
        /* non-fatal: the reply still renders, it just isn't saved */
      }
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `Something broke, try again. (${e instanceof Error ? e.message : e})` }]);
    } finally {
      setBusy(false);
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    }
  };

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
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
      />
      <View style={[s.composer, { paddingBottom: 12 + insets.bottom }]}>
        <TextInput
          style={s.input}
          placeholder="What are you thinking of eating?"
          placeholderTextColor={C.muted}
          value={input}
          onChangeText={setInput}
          editable={!busy}
          multiline
        />
        <Pressable style={[s.send, (busy || !input.trim()) && s.sendDim]} onPress={send} disabled={busy || !input.trim()}>
          {busy ? <ActivityIndicator color={C.amberInk} size="small" /> : <Text style={s.sendText}>↑</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  list: { flex: 1 },
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { color: C.muted, textAlign: "center", marginTop: 60, fontSize: 16 },
  bubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  user: { alignSelf: "flex-end", backgroundColor: C.amber, borderBottomRightRadius: 5 },
  assistant: { alignSelf: "flex-start", backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 5 },
  userText: { color: C.amberInk, fontSize: 15.5, lineHeight: 21 },
  assistantText: { color: C.fg, fontSize: 15.5, lineHeight: 21 },
  photo: { width: 180, height: 180, borderRadius: 12, backgroundColor: C.line },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: C.line },
  input: {
    flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 20, color: C.fg,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 15.5, maxHeight: 120, backgroundColor: C.card,
  },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.amber, alignItems: "center", justifyContent: "center" },
  sendDim: { opacity: 0.4 },
  sendText: { color: C.amberInk, fontSize: 20, fontWeight: "800" },
});
