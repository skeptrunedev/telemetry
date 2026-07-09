import { useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { C } from "./theme";
import { agent, ChatMessage } from "./api";

export function Agent() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<ChatMessage>>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const reply = await agent(next);
      setMessages([...next, { role: "assistant", content: reply }]);
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
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <FlatList
        ref={list}
        style={s.list}
        contentContainerStyle={s.listContent}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <View style={[s.bubble, item.role === "user" ? s.user : s.assistant]}>
            <Text style={item.role === "user" ? s.userText : s.assistantText}>{item.content}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>Ask before you eat.</Text>}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
      />
      <View style={s.composer}>
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
  bubble: { maxWidth: "82%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  user: { alignSelf: "flex-end", backgroundColor: C.amber, borderBottomRightRadius: 5 },
  assistant: { alignSelf: "flex-start", backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 5 },
  userText: { color: C.amberInk, fontSize: 15.5, lineHeight: 21 },
  assistantText: { color: C.fg, fontSize: 15.5, lineHeight: 21 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: C.line },
  input: {
    flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 20, color: C.fg,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 15.5, maxHeight: 120, backgroundColor: C.card,
  },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.amber, alignItems: "center", justifyContent: "center" },
  sendDim: { opacity: 0.4 },
  sendText: { color: C.amberInk, fontSize: 20, fontWeight: "800" },
});
