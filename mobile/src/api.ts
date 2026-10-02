import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
// RN's global fetch can't expose a streaming response body; expo/fetch returns
// a web-standard streaming Response so we can read the NDJSON token stream.
import { fetch as streamFetch } from "expo/fetch";

const BASE = "https://app.skcal.fit";
const TOKEN_KEY = "skcal_session_token";

// expo-secure-store has no web implementation (its web module is empty), so
// the Expo-web preview falls back to localStorage.
const WEB = Platform.OS === "web";

// Sent on every request to the worker so it knows which app is calling. The
// worker's temporary ANDROID_FREE_UNTIL_PLAY_BILLING policy keys off
// `android`; nothing is sent from the web preview, which isn't a store build.
const CLIENT_HEADERS: Record<string, string> =
  Platform.OS === "android" || Platform.OS === "ios" ? { "x-skcal-client": Platform.OS } : {};

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
  // A photo just sent from this device is still its inline data URL.
  if (image.startsWith("data:")) return { uri: image };
  const uri = image.startsWith("http") ? image : `${BASE}${image}`;
  return { uri, headers: { ...CLIENT_HEADERS, ...(cachedToken ? { authorization: `Bearer ${cachedToken}` } : {}) } };
}

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...CLIENT_HEADERS,
      ...(init.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
}

export async function sendOtp(phoneNumber: string): Promise<void> {
  const r = await fetch(`${BASE}/api/auth/phone-number/send-otp`, {
    method: "POST",
    headers: { ...CLIENT_HEADERS, "content-type": "application/json" },
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
    headers: { ...CLIENT_HEADERS, "content-type": "application/json" },
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

// NDJSON event protocol shared with the web client (src/client/Coach.tsx):
// {t:"conversation",id} names the saved conversation, {t:"text",v} appends a
// reply delta, {t:"tool"} / {t:"result"} bracket a tool call. The reply is the
// concatenation of every text delta.
type AgentEvent =
  | { t: "conversation"; id?: string }
  | { t: "error"; message?: string }
  | { t: "text"; v?: string }
  | { t: "tool"; id?: string; name?: string; args?: unknown }
  | { t: "result"; id?: string; result?: unknown };

// Streaming twin of agent(): POSTs to /api/agent/stream and reads the response
// body incrementally via expo/fetch (RN's global fetch has no readable body).
// onText is called with the full accumulated reply on each text delta so the UI
// re-renders live. onTool fires when a tool call starts (done false) and when
// its result is back (done true) so the UI can show what the coach is doing.
//
// The worker saves the turn into conversationId (null starts a new one) and
// the resolved value carries the id it used. If the stream can't start, the
// non-streaming agent() answers instead and the turn is saved from here.
export async function agentStream(
  messages: ChatMessage[],
  conversationId: string | null,
  onText: (fullReply: string) => void,
  onTool?: (name: string, done: boolean) => void,
): Promise<{ reply: string; conversationId: string | null }> {
  const token = await getToken();
  const day = new Date().toLocaleDateString("en-CA");
  const tz = new Date().getTimezoneOffset();
  let res: Response;
  try {
    res = await streamFetch(`${BASE}/api/agent/stream?date=${day}`, {
      method: "POST",
      headers: {
        ...CLIENT_HEADERS,
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ messages, date: day, tz, conversationId }),
    });
  } catch {
    // Network/stream setup failed — fall back to the buffered endpoint.
    return agentFallback(messages, conversationId, onText);
  }
  if (!res.ok || !res.body) {
    // Non-2xx or no streamable body — buffered fallback keeps chat working.
    return agentFallback(messages, conversationId, onText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let reply = "";
  let savedId = conversationId;
  let failure: string | null = null;
  const handle = (line: string) => {
    const s = line.trim();
    if (!s) return;
    let ev: AgentEvent;
    try {
      ev = JSON.parse(s) as AgentEvent;
    } catch {
      return;
    }
    if (ev.t === "conversation" && ev.id) {
      savedId = ev.id;
    } else if (ev.t === "text" && ev.v) {
      reply += ev.v;
      onText(reply);
    } else if (ev.t === "tool") {
      onTool?.(typeof ev.name === "string" ? ev.name : "", false);
    } else if (ev.t === "result") {
      onTool?.("", true);
    } else if (ev.t === "error") {
      failure = ev.message || "The coach couldn't finish that reply.";
    }
  };

  for (;;) {
    // A reply that goes quiet this long is stuck: stop waiting and say so.
    const { done, value } = await withTimeout(reader.read(), STREAM_IDLE_MS, () => reader.cancel().catch(() => {}));
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) handle(buf);
  if (failure) throw new Error(failure);
  return { reply, conversationId: savedId };
}

// Longest the reply stream may go without sending anything. Tool calls report
// as they start, so a healthy reply is never silent anywhere near this long.
const STREAM_IDLE_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error("the coach took too long to answer"));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// The buffered endpoint doesn't save, so the turn is saved here.
async function agentFallback(
  messages: ChatMessage[],
  conversationId: string | null,
  onText: (fullReply: string) => void,
): Promise<{ reply: string; conversationId: string | null }> {
  const reply = await agent(messages);
  onText(reply);
  const user = messages[messages.length - 1];
  if (!user || !reply) return { reply, conversationId };
  const turn: ChatMessage[] = [user, { role: "assistant", content: reply }];
  try {
    if (conversationId) {
      await appendMessages(conversationId, turn);
      return { reply, conversationId };
    }
    const title = typeof user.content === "string" ? user.content : "[photo]";
    return { reply, conversationId: (await createConversation(title, turn)).id };
  } catch {
    return { reply, conversationId };
  }
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

/**
 * Permanently delete the signed-in account and all of its data. The worker
 * cancels a Stripe subscription itself; an App Store one has to be cancelled in
 * the Apple ID settings. Throws the worker's error message on failure.
 */
export async function deleteAccount(): Promise<void> {
  const r = await req(`/api/account`, { method: "DELETE" });
  if (!r.ok) {
    const b = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `delete account → ${r.status}`);
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const r = await req(`/api/agent/conversations/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`deleteConversation → ${r.status}`);
}

// ---- Reminders (same endpoints as the web dashboard card) ----
export type Reminder = {
  id: string;
  instruction: string;
  time: string; // "HH:MM" local to tz
  days: string; // daily | weekdays | weekends | "mon,wed,fri"
  onceDate: string | null;
  tz: string;
  enabled: boolean;
  nextFireAt: number;
  lastSentAt: number | null;
  createdAt: number;
};

export async function listReminders(): Promise<{ reminders: Reminder[]; phoneLinked: boolean }> {
  const r = await req(`/api/reminders`);
  if (!r.ok) throw new Error(`reminders → ${r.status}`);
  return r.json() as Promise<{ reminders: Reminder[]; phoneLinked: boolean }>;
}

export async function deleteReminder(id: string): Promise<void> {
  const r = await req(`/api/reminders/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`deleteReminder → ${r.status}`);
}

export async function setReminderEnabled(id: string, enabled: boolean): Promise<void> {
  const r = await req(`/api/reminders/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
  if (!r.ok) throw new Error(`setReminderEnabled → ${r.status}`);
}

// Turn a failed response into the error the screens already branch on
// (unauthorized / subscription required), else the worker's own message.
async function fail(r: Response, label: string): Promise<never> {
  if (r.status === 401) throw new Error("unauthorized");
  if (r.status === 402) throw new Error("subscription required");
  const b = (await r.json().catch(() => ({}))) as { error?: string };
  throw new Error(b.error ?? `${label} → ${r.status}`);
}

// ---- Body: weigh-ins and measurements (same endpoints as the web app) ----
export type WeightReading = {
  id: number;
  ts: number;
  weightKg: number;
  bodyFatPct: number | null;
  note: string | null;
  source: string;
};
export type Measurement = { id: number; ts: number; site: string; valueCm: number; source: string };

/** Up to 365 weigh-ins, newest first. */
export async function listWeight(): Promise<WeightReading[]> {
  const r = await req(`/api/weight`);
  if (!r.ok) return fail(r, "weight");
  return r.json() as Promise<WeightReading[]>;
}

// Also used by the Apple Health sync (weight + note only).
export async function logWeight(weightKg: number, note?: string | null, bodyFatPct?: number | null): Promise<void> {
  const r = await req(`/api/weight`, { method: "POST", body: JSON.stringify({ weightKg, bodyFatPct, note }) });
  if (!r.ok) return fail(r, "logWeight");
}

export async function setWeightNote(id: number, note: string | null): Promise<void> {
  const r = await req(`/api/weight/${id}`, { method: "PATCH", body: JSON.stringify({ note }) });
  if (!r.ok) return fail(r, "weight note");
}

/** Up to 500 measurements, newest first. */
export async function listMeasurements(): Promise<Measurement[]> {
  const r = await req(`/api/measurements`);
  if (!r.ok) return fail(r, "measurements");
  return r.json() as Promise<Measurement[]>;
}

export async function addMeasurement(site: string, valueCm: number): Promise<void> {
  const r = await req(`/api/measurements`, { method: "POST", body: JSON.stringify({ site, valueCm }) });
  if (!r.ok) return fail(r, "addMeasurement");
}

// ---- Food log (same endpoints as the web FoodLog card) ----
export type LoggedItem = { id: number; name: string; kcal: number; proteinG: number };
export type Meal = { id: string; note: string | null; createdAt: number; photoKeys: string[]; items: LoggedItem[] };

/** Meals logged on a local YYYY-MM-DD day, newest first. */
export async function listMeals(date: string): Promise<Meal[]> {
  const r = await req(`/api/nutrition/meals?date=${date}`);
  if (!r.ok) return fail(r, "meals");
  return r.json() as Promise<Meal[]>;
}

export async function deleteMeal(id: string): Promise<void> {
  const r = await req(`/api/nutrition/meals/${id}`, { method: "DELETE" });
  if (!r.ok) return fail(r, "deleteMeal");
}

export async function deleteMealItem(id: number): Promise<void> {
  const r = await req(`/api/nutrition/items/${id}`, { method: "DELETE" });
  if (!r.ok) return fail(r, "deleteItem");
}

/** Partial edit of a logged item; the worker recomputes the day's totals. */
export async function editMealItem(id: number, patch: { name?: string; kcal?: number; proteinG?: number }): Promise<void> {
  const r = await req(`/api/nutrition/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (!r.ok) return fail(r, "editItem");
}

/** <Image> source for a meal photo key (owner-scoped, so it needs the bearer). */
export const mealPhotoSource = (key: string) => photoSource(`/api/nutrition/photo/${key}`);

// Same freeform-description path the agent's log_workout tool uses: the worker
// parses the text into a normalized workout row and logs it.
export async function describeWorkout(text: string, date?: string): Promise<void> {
  const r = await req(`/api/workouts/describe`, {
    method: "POST",
    body: JSON.stringify({ text, date, tz: new Date().getTimezoneOffset() }),
  });
  if (!r.ok) throw new Error(`describeWorkout → ${r.status}`);
}

// ---- Apple in-app purchase ----
// Both routes are exempt from the worker's 402 subscription gate, so an
// unsubscribed account can still reach them to buy or restore.

export type AppleIapConfig = {
  /** False until the In-App Purchase key secrets are set on the worker. */
  configured: boolean;
  bundleId: string;
  productIds: string[];
  /** Passed to StoreKit at purchase time so the transaction is bound to this account. */
  appAccountToken: string;
};

export async function appleConfig(): Promise<AppleIapConfig> {
  const r = await req(`/api/apple/config`);
  if (!r.ok) throw new Error(`apple config → ${r.status}`);
  return r.json() as Promise<AppleIapConfig>;
}

export type AppleVerifyResult = {
  ok: boolean;
  status: string;
  periodEnd: number | null;
  productId: string;
  environment: string;
  active: boolean;
};

/**
 * Hand a StoreKit transaction id to the worker, which re-fetches it from Apple
 * and writes the entitlement. Nothing the app says about the purchase is
 * trusted, so the id is all we send.
 */
export async function appleVerify(transactionId: string): Promise<AppleVerifyResult> {
  const r = await req(`/api/apple/verify`, { method: "POST", body: JSON.stringify({ transactionId }) });
  const body = (await r.json().catch(() => ({}))) as Partial<AppleVerifyResult> & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `verify → ${r.status}`);
  return body as AppleVerifyResult;
}

export const kgToLb = (kg: number) => kg * 2.2046226218;
export const lbToKg = (lb: number) => lb / 2.2046226218;
export const cmToIn = (cm: number) => cm / 2.54;
export const inToCm = (inch: number) => inch * 2.54;

/** Local calendar day as YYYY-MM-DD (the key meals are logged under). */
export const todayLocal = () => new Date().toLocaleDateString("en-CA");
