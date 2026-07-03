import type { DashboardData, NutritionDay, Targets } from "../shared/types";

function reauth(): never {
  // Cloudflare Access answered a background fetch with a cross-origin login
  // redirect (session expired/logged out). A top-level reload lets Access show
  // its login page in a real navigation instead of a dead "Failed to fetch".
  window.location.reload();
  throw new Error("Session expired — reloading to sign in…");
}

// Use redirect:"manual" so an Access login redirect surfaces as an
// opaqueredirect response we can detect, rather than a thrown CORS error.
async function rawFetch(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, { ...init, redirect: "manual" });
  if (r.type === "opaqueredirect" || r.status === 0) reauth();
  return r;
}

async function jget<T>(url: string): Promise<T> {
  const r = await rawFetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function jsend(url: string, method: string, body: unknown): Promise<void> {
  const r = await rawFetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}`);
}

export type MealItem = { name: string; kcal: number; proteinG: number };
export type LoggedItem = MealItem & { id: number };
export type MealAnalysis = {
  ok: true;
  mealId: string;
  items: MealItem[];
  totalKcal: number;
  totalProteinG: number;
  note: string;
  photoKeys: string[];
};
export type Meal = { id: string; note: string | null; createdAt: number; photoKeys: string[]; items: LoggedItem[] };
export type CoachMessage = { role: "user" | "assistant"; content: string };
export type CoachConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: CoachMessage[];
};
export type WeightReading = { id: number; ts: number; weightKg: number; bodyFatPct: number | null; note: string | null; source: string };
export type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; createdAt: number; lastUsedAt: number | null };
export type Billing = { active: boolean; exempt: boolean; status: string | null; periodEnd: number | null; priceUsd: number };
export type Channel = { id: string; kind: "phone" | "telegram"; value: string; verified: boolean; createdAt: number };

export const api = {
  dashboard: (date: string) => jget<DashboardData>(`/api/dashboard?date=${date}&tz=${new Date().getTimezoneOffset()}`),
  whoami: () => jget<{ email: string }>(`/api/whoami`),
  targets: () => jget<Targets>(`/api/targets`),
  addWeight: (weightKg: number, bodyFatPct?: number | null, note?: string | null) =>
    jsend(`/api/weight`, "POST", { weightKg, bodyFatPct, note }),
  weightList: () => jget<WeightReading[]>(`/api/weight`),
  setWeightNote: (id: number, note: string | null) => jsend(`/api/weight/${id}`, "PATCH", { note }),
  addMeasurement: (site: string, valueCm: number) =>
    jsend(`/api/measurements`, "POST", { site, valueCm }),
  putNutrition: (d: NutritionDay) => jsend(`/api/nutrition`, "PUT", d),
  analyzeMeal: async (date: string, files: Blob[], note?: string): Promise<MealAnalysis> => {
    const fd = new FormData();
    files.forEach((f, i) => fd.append("photos", f, `meal-${i}.jpg`));
    if (note?.trim()) fd.append("note", note.trim());
    const r = await rawFetch(`/api/nutrition/analyze?date=${date}`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`analyze → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<MealAnalysis>;
  },
  describeMeal: async (date: string, text: string): Promise<MealAnalysis> => {
    const r = await rawFetch(`/api/nutrition/describe?date=${date}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error(`describe → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<MealAnalysis>;
  },
  coach: async (messages: CoachMessage[], date?: string): Promise<{ reply: string }> => {
    const url = date ? `/api/agent?date=${date}` : `/api/agent`;
    const r = await rawFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, date }),
    });
    if (!r.ok) throw new Error(`coach → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<{ reply: string }>;
  },
  // Streaming variant for the in-app chat: returns the raw Response so the
  // caller can read the plain-text token stream off `.body`.
  coachStream: async (messages: CoachMessage[], date: string, signal?: AbortSignal): Promise<Response> => {
    const r = await rawFetch(`/api/agent/stream?date=${date}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, date }),
      signal,
    });
    if (!r.ok) throw new Error(`coach → ${r.status}: ${await r.text().catch(() => "")}`);
    return r;
  },
  // ---- Coach conversation history ----
  listConversations: () => jget<CoachConversation[]>(`/api/agent/conversations`),
  createConversation: async (title: string, messages: CoachMessage[]): Promise<{ id: string; title: string }> => {
    const r = await rawFetch(`/api/agent/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, messages }),
    });
    if (!r.ok) throw new Error(`createConversation → ${r.status}`);
    return r.json() as Promise<{ id: string; title: string }>;
  },
  appendMessages: (id: string, messages: CoachMessage[]) =>
    jsend(`/api/agent/conversations/${id}/messages`, "POST", { messages }),
  deleteConversation: (id: string) => jsend(`/api/agent/conversations/${id}`, "DELETE", undefined),
  meals: (date: string) => jget<Meal[]>(`/api/nutrition/meals?date=${date}`),
  deleteMeal: (id: string) => jsend(`/api/nutrition/meals/${id}`, "DELETE", undefined),
  deleteItem: (id: number) => jsend(`/api/nutrition/items/${id}`, "DELETE", undefined),
  photoUrl: (key: string) => `/api/nutrition/photo/${key}`,
  listChannels: () => jget<Channel[]>(`/api/channels`),
  startPhoneLink: (phone: string) => jsend(`/api/channels/phone/start`, "POST", { phone }),
  verifyPhoneLink: async (phone: string, code: string): Promise<Channel> => {
    const r = await rawFetch(`/api/channels/phone/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, code }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `verify → ${r.status}`);
    return r.json() as Promise<Channel>;
  },
  deleteChannel: (id: string) => jsend(`/api/channels/${id}`, "DELETE", undefined),
  billing: () => jget<Billing>(`/api/billing`),
  billingCheckout: async (): Promise<{ url: string }> => {
    const r = await rawFetch(`/api/billing/checkout`, { method: "POST" });
    if (!r.ok) throw new Error(`checkout → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<{ url: string }>;
  },
  billingPortal: async (): Promise<{ url: string }> => {
    const r = await rawFetch(`/api/billing/portal`, { method: "POST" });
    if (!r.ok) throw new Error(`portal → ${r.status}`);
    return r.json() as Promise<{ url: string }>;
  },
  listApiKeys: () => jget<ApiKey[]>(`/api/keys`),
  createApiKey: async (name: string, scopes: string[]): Promise<ApiKey & { token: string }> => {
    const r = await rawFetch(`/api/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scopes }),
    });
    if (!r.ok) throw new Error(`createApiKey → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<ApiKey & { token: string }>;
  },
  deleteApiKey: (id: string) => jsend(`/api/keys/${id}`, "DELETE", undefined),
  setAvatar: async (file: Blob): Promise<{ image: string }> => {
    const fd = new FormData();
    fd.append("photo", file, "avatar.jpg");
    const r = await rawFetch(`/api/profile/avatar`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`avatar → ${r.status}`);
    return r.json() as Promise<{ image: string }>;
  },
};

export const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local tz
