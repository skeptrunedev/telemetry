import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, SafeAreaView, StatusBar } from "react-native";
import { C } from "./src/theme";
import { getToken, setToken } from "./src/api";
import { SignIn } from "./src/SignIn";
import { Today } from "./src/Today";
import { Agent } from "./src/Agent";

type Tab = "today" | "agent";

export default function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("today");

  useEffect(() => {
    getToken().then((t) => {
      setAuthed(!!t);
      setReady(true);
    });
  }, []);

  if (!ready) return <View style={s.boot} />;
  if (!authed) return <SignIn onSignedIn={() => setAuthed(true)} />;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.topbar}>
        <Text style={s.brand}>skcal</Text>
        <Pressable
          onPress={async () => {
            await setToken(null);
            setAuthed(false);
          }}
        >
          <Text style={s.signout}>sign out</Text>
        </Pressable>
      </View>
      <View style={s.body}>
        {tab === "today" ? (
          <Today
            onAuthError={async () => {
              await setToken(null);
              setAuthed(false);
            }}
          />
        ) : (
          <Agent />
        )}
      </View>
      <View style={s.tabs}>
        {(["today", "agent"] as Tab[]).map((t) => (
          <Pressable key={t} style={s.tabBtn} onPress={() => setTab(t)}>
            <Text style={[s.tabText, tab === t && s.tabActive]}>{t === "today" ? "Today" : "Agent"}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  boot: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1, backgroundColor: C.bg },
  topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  brand: { color: C.fg, fontFamily: "monospace", letterSpacing: 3, fontSize: 16, fontWeight: "700" },
  signout: { color: C.muted, fontSize: 13 },
  body: { flex: 1 },
  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabText: { color: C.muted, fontSize: 15, fontWeight: "600" },
  tabActive: { color: C.amber },
});
