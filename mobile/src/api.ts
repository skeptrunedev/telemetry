import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const BASE = "https://app.skcal.fit";
const TOKEN_KEY = "skcal_session_token";

// expo-secure-store has no web implementation (its web module is empty), so
// the Expo-web preview falls back to localStorage.
const WEB = Platform.OS === "web";

// Kept warm by getToken/setToken so synchronous callers (e.g. <Image> auth
// headers) can read it without an async hop — App always getToken()s on boot.
let cachedToken: string | null = null;

export async function getToken(): Promise<string | null> {
  cachedToken = WEB ? globalThis.localStorage?.getItem(TOKEN_KEY) ?? null : await SecureStore.getItemAsync(TOKEN_KEY);
  return cachedToken;
}
export async function setToken(t: string | null): Promise<void> {
  cachedToken = t;
  if (WEB) {
    if (t) globalThis.localStorage?.setItem(TOKEN_KEY, t);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// RN <Image> source for a persisted agent photo (`/api/agent/photos/…`) —
// same-origin on the web app, so mobile must attach the bearer header itself.
export function photoSource(image: string): { uri: string; headers?: Record<string, string> } {
  const uri = image.startsWith("http") ? image : `${BASE}${image}`;
  return cachedToken ? { uri, headers: { authorization: `Bearer ${cachedToken}` } } : { uri };
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
}

export async function sendOtp(phoneNumber: string): Promise<void> {
  const r = await fetch(`${BASE}/api/auth/phone-number/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber }),
  });
  if (!r.ok) {
    const b = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(b.message ?? `send-otp failed (${r.status})`);
  }
}

export async function verifyOtp(phoneNumber: string, code: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/phone-number/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber, code }),
  });
  if (!r.ok) {
    const b = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(b.message ?? `verify failed (${r.status})`);
  }
  // better-auth bearer plugin surfaces the session token in this header
  const token = r.headers.get("set-auth-token");
  if (!token) throw new Error("no session token in response");
  await setToken(token);
  return token;
}

export type Dashboard = {
  weight: {
    latestKg: number | null;
    weeklyAvgKg: number | null;
    bodyFatPct: number | null;
    trend: { ts: number; kg: number }[];
  };
  targets: {
    goalWeightKg: number | null;
    startWeightKg: number | null;
    dailyKcalTarget: number | null;
    proteinTargetG: number | null;
  };
  measurementsLatest: { site: string; valueCm: number; ts: number }[];
  shoulderToWaist: number | null;
  nutritionToday: { kcal: number | null; proteinG: number | null } | null;
};

export async function dashboard(): Promise<Dashboard> {
  const day = new Date().toLocaleDateString("en-CA");
  const tz = new Date().getTimezoneOffset();
  const r = await req(`/api/dashboard?date=${day}&tz=${tz}`);
  if (r.status === 401) throw new Error("unauthorized");
  if (r.status === 402) throw new Error("subscription required");
  if (!r.ok) throw new Error(`dashboard → ${r.status}`);
  return r.json() as Promise<Dashboard>;
}

// Message shapes shared with the web client (src/client/api.ts): content is a
// plain string or ordered parts (text and/or photos persisted in R2).
export type ChatPart = { type: "text"; text: string } | { type: "image"; image: string };
export type ChatMessage = { role: "user" | "assistant"; content: string | ChatPart[] };
export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

export async function whoami(): Promise<{ email: string }> {
  const r = await req(`/api/whoami`);
  if (!r.ok) throw new Error(`whoami → ${r.status}`);
  return r.json() as Promise<{ email: string }>;
}

export async function agent(messages: ChatMessage[]): Promise<string> {
  const r = await req(`/api/agent`, {
    method: "POST",
    body: JSON.stringify({ messages, tz: new Date().getTimezoneOffset() }),
  });
  if (!r.ok) throw new Error(`agent → ${r.status}`);
  const b = (await r.json()) as { reply: string };
  return b.reply;
}

// ---- Agent conversation history (same endpoints the web app uses) ----
export async function listConversations(): Promise<Conversation[]> {
  const r = await req(`/api/agent/conversations`);
  if (!r.ok) throw new Error(`conversations → ${r.status}`);
  return r.json() as Promise<Conversation[]>;
}

export async function createConversation(title: string, messages: ChatMessage[]): Promise<{ id: string }> {
  const r = await req(`/api/agent/conversations`, {
    method: "POST",
    body: JSON.stringify({ title, messages }),
  });
  if (!r.ok) throw new Error(`createConversation → ${r.status}`);
  return r.json() as Promise<{ id: string }>;
}

export async function appendMessages(id: string, messages: ChatMessage[]): Promise<void> {
  const r = await req(`/api/agent/conversations/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
  if (!r.ok) throw new Error(`appendMessages → ${r.status}`);
}

export async function deleteConversation(id: string): Promise<void> {
  const r = await req(`/api/agent/conversations/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`deleteConversation → ${r.status}`);
}

export const kgToLb = (kg: number) => kg * 2.2046226218;
export const cmToIn = (cm: number) => cm / 2.54;
