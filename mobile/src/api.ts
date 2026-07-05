import * as SecureStore from "expo-secure-store";

const BASE = "https://app.skcal.fit";
const TOKEN_KEY = "skcal_session_token";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function setToken(t: string | null): Promise<void> {
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
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

export type ChatMessage = { role: "user" | "assistant"; content: string };

export async function agent(messages: ChatMessage[]): Promise<string> {
  const r = await req(`/api/agent`, {
    method: "POST",
    body: JSON.stringify({ messages, tz: new Date().getTimezoneOffset() }),
  });
  if (!r.ok) throw new Error(`agent → ${r.status}`);
  const b = (await r.json()) as { reply: string };
  return b.reply;
}

export const kgToLb = (kg: number) => kg * 2.2046226218;
export const cmToIn = (cm: number) => cm / 2.54;
