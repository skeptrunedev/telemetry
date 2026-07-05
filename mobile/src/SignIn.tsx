import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { C } from "./theme";
import { sendOtp, verifyOtp } from "./api";

function normalizePhone(input: string): string | null {
  const s = input.replace(/[\s().-]/g, "");
  if (s.startsWith("+")) return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [e164, setE164] = useState("");

  const send = async () => {
    const n = normalizePhone(phone);
    if (!n) {
      setError("Enter a valid phone number");
      return;
    }
    setE164(n);
    setError(null);
    setBusy(true);
    try {
      await sendOtp(n);
      setStage("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(e164, code.trim());
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.wrap}>
      <View style={s.card}>
        <Text style={s.brand}>skcal</Text>
        <Text style={s.title}>Sign in</Text>
        <Text style={s.sub}>
          {stage === "phone" ? "Enter your phone number and we'll text you a code." : `We texted a code to ${e164}.`}
        </Text>
        {stage === "phone" ? (
          <>
            <TextInput
              style={s.input}
              placeholder="(415) 555-0132"
              placeholderTextColor={C.muted}
              keyboardType="phone-pad"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
              editable={!busy}
            />
            <Pressable style={[s.btn, busy && s.btnDim]} onPress={send} disabled={busy}>
              {busy ? <ActivityIndicator color={C.amberInk} /> : <Text style={s.btnText}>Text me a code</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              style={s.input}
              placeholder="123456"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              value={code}
              onChangeText={setCode}
              editable={!busy}
            />
            <Pressable style={[s.btn, busy && s.btnDim]} onPress={verify} disabled={busy}>
              {busy ? <ActivityIndicator color={C.amberInk} /> : <Text style={s.btnText}>Sign in</Text>}
            </Pressable>
            <Pressable onPress={() => setStage("phone")} disabled={busy}>
              <Text style={s.ghost}>Use a different number</Text>
            </Pressable>
          </>
        )}
        {error && <Text style={s.err}>{error}</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, justifyContent: "center", padding: 20 },
  card: { backgroundColor: C.card, borderRadius: 18, padding: 24, borderWidth: 1, borderColor: C.line },
  brand: { color: C.amber, fontFamily: "monospace", letterSpacing: 4, fontSize: 14, marginBottom: 14 },
  title: { color: C.fg, fontSize: 30, fontWeight: "800", marginBottom: 8 },
  sub: { color: C.muted, fontSize: 15, marginBottom: 20, lineHeight: 21 },
  input: {
    borderWidth: 1, borderColor: C.amber, borderRadius: 12, color: C.fg,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, marginBottom: 12,
  },
  btn: { backgroundColor: C.amber, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnDim: { opacity: 0.6 },
  btnText: { color: C.amberInk, fontWeight: "700", fontSize: 16 },
  ghost: { color: C.muted, textAlign: "center", marginTop: 14, fontSize: 14 },
  err: { color: "#ff8a70", marginTop: 12, fontSize: 14 },
});
