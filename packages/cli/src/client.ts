import { loadCredentials } from "./config";

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
    private token: string,
  ) {}

  static fromConfig(): TelemetryClient {
    const creds = loadCredentials();
    if (!creds) throw new NotAuthenticatedError();
    return new TelemetryClient(creds.baseUrl, creds.token);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      redirect: "manual",
      headers: {
        // Cloudflare Access accepts the app token here in lieu of the cookie.
        "cf-access-token": this.token,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // An Access login redirect (status 0/3xx) means the token expired/was rejected.
    if (res.status === 0 || (res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) {
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
