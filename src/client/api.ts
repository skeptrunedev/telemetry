import type { DashboardData, NutritionDay, Targets } from "../shared/types";

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function jsend(url: string, method: string, body: unknown): Promise<void> {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}`);
}

export type MealItem = { name: string; kcal: number; proteinG: number };
export type MealAnalysis = {
  ok: true;
  mealId: string;
  items: MealItem[];
  totalKcal: number;
  totalProteinG: number;
  note: string;
  photoKeys: string[];
};
export type Meal = { id: string; note: string | null; createdAt: number; photoKeys: string[]; items: MealItem[] };

export const api = {
  dashboard: (date: string) => jget<DashboardData>(`/api/dashboard?date=${date}`),
  whoami: () => jget<{ email: string }>(`/api/whoami`),
  targets: () => jget<Targets>(`/api/targets`),
  addWeight: (weightKg: number, bodyFatPct?: number | null) =>
    jsend(`/api/weight`, "POST", { weightKg, bodyFatPct }),
  addMeasurement: (site: string, valueCm: number) =>
    jsend(`/api/measurements`, "POST", { site, valueCm }),
  putNutrition: (d: NutritionDay) => jsend(`/api/nutrition`, "PUT", d),
  analyzeMeal: async (date: string, files: File[]): Promise<MealAnalysis> => {
    const fd = new FormData();
    for (const f of files) fd.append("photos", f);
    const r = await fetch(`/api/nutrition/analyze?date=${date}`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`analyze → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json() as Promise<MealAnalysis>;
  },
  meals: (date: string) => jget<Meal[]>(`/api/nutrition/meals?date=${date}`),
  deleteMeal: (id: string) => jsend(`/api/nutrition/meals/${id}`, "DELETE", undefined),
  photoUrl: (key: string) => `/api/nutrition/photo/${key}`,
};

export const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local tz
