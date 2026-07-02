import { loadCredentials, saveCredentials, DEFAULT_BASE_URL } from "./config";
import type { OAuthCreds } from "./config";
import { refreshAccessToken } from "./auth";

// Shapes mirror the API's OpenAPI components (skcal.skeptrune.com/openapi.json).
export type WhoAmI = { email: string };
export type WeightReading = {
  id: number;
  ts: number;
  weightKg: number;
  bodyFatPct: number | null;
  note: string | null;
  source: string;
};
export type Targets = {
  goalWeightKg: number | null;
  startWeightKg: number | null;
  dailyKcalTarget: number | null;
  proteinTargetG: number | null;
};
export type NutritionDay = { kcal: number | null; proteinG: number | null } | null;
export type DashboardData = {
  weight: { latestKg: number | null; weeklyAvgKg: number | null; bodyFatPct: number | null; note: string | null };
  targets: Targets;
  measurementsLatest: { site: string; valueCm: number }[];
  shoulderToWaist: number | null;
  nutritionToday: NutritionDay;
};
export type MealAnalysis = {
  mealId: string;
  items: { name: string; kcal: number; proteinG: number }[];
  totalKcal: number;
  totalProteinG: number;
  note: string;
};
export type Meal = {
  id: string;
  note: string | null;
  createdAt: number;
  items: { id: number; name: string; kcal: number; proteinG: number }[];
};

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not signed in. Run `skcal login` first.");
    this.name = "NotAuthenticatedError";
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export class TelemetryClient {
  constructor(
    private baseUrl: string,
    private bearer: string,
    // Present when authed via the browser OAuth flow — enables refresh-on-401.
    private oauth?: OAuthCreds,
  ) {}

  // Resolve auth from (in order) the SKCAL_API_KEY env var, a saved API key,
  // saved OAuth tokens (browser flow), or a legacy token. Env-only works with
  // no `skcal login` (handy in CI).
  static fromConfig(): TelemetryClient {
    const creds = loadCredentials();
    const baseUrl = creds?.baseUrl || process.env.SKCAL_BASE_URL || DEFAULT_BASE_URL;
    if (process.env.SKCAL_API_KEY) return new TelemetryClient(baseUrl, process.env.SKCAL_API_KEY);
    if (creds?.apiKey) return new TelemetryClient(baseUrl, creds.apiKey);
    if (creds?.oauth) return new TelemetryClient(baseUrl, creds.oauth.accessToken, creds.oauth);
    if (creds?.token) return new TelemetryClient(baseUrl, creds.token);
    throw new NotAuthenticatedError();
  }

  private send(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      redirect: "manual",
      headers: {
        authorization: `Bearer ${this.bearer}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  // Try to swap the OAuth refresh token for a fresh access token, persisting it.
  private async tryRefresh(): Promise<boolean> {
    const rt = this.oauth?.refreshToken;
    if (!this.oauth || !rt) return false;
    try {
      const r = await refreshAccessToken({ refreshToken: rt, clientId: this.oauth.clientId, tokenEndpoint: this.oauth.tokenEndpoint });
      this.bearer = r.accessToken;
      this.oauth = { ...this.oauth, accessToken: r.accessToken, refreshToken: r.refreshToken ?? this.oauth.refreshToken, expiresAt: r.expiresAt };
      const creds = loadCredentials();
      if (creds?.oauth) saveCredentials({ ...creds, oauth: this.oauth });
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res = await this.send(method, path, body);
    // A 401 with OAuth creds may just be an expired access token — refresh once.
    if (res.status === 401 && (await this.tryRefresh())) {
      res = await this.send(method, path, body);
    }
    // Session-redirect (opaqueredirect/0/3xx) or an unrecoverable 401 → re-login.
    if (res.status === 0 || (res.status >= 300 && res.status < 400) || res.status === 401) {
      throw new NotAuthenticatedError();
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        msg = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        /* keep raw text */
      }
      throw new ApiError(res.status, msg || `HTTP ${res.status}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  whoami() {
    return this.request<WhoAmI>("GET", "/api/whoami");
  }
  dashboard(date?: string) {
    return this.request<DashboardData>("GET", `/api/dashboard${date ? `?date=${date}` : ""}`);
  }
  listWeight() {
    return this.request<WeightReading[]>("GET", "/api/weight");
  }
  addWeight(weightKg: number, bodyFatPct?: number | null, note?: string | null) {
    return this.request<{ ok: true }>("POST", "/api/weight", { weightKg, bodyFatPct, note });
  }
  setWeightNote(id: number, note: string | null) {
    return this.request<{ ok: true }>("PATCH", `/api/weight/${id}`, { note });
  }
  addMeasurement(site: string, valueCm: number) {
    return this.request<{ ok: true }>("POST", "/api/measurements", { site, valueCm });
  }
  targets() {
    return this.request<Targets>("GET", "/api/targets");
  }
  describeMeal(text: string, date?: string) {
    return this.request<MealAnalysis>("POST", `/api/nutrition/describe${date ? `?date=${date}` : ""}`, { text });
  }
  listMeals(date?: string) {
    return this.request<Meal[]>("GET", `/api/nutrition/meals${date ? `?date=${date}` : ""}`);
  }
}
