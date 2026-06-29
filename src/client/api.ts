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

export const api = {
  dashboard: (date: string) => jget<DashboardData>(`/api/dashboard?date=${date}`),
  whoami: () => jget<{ email: string }>(`/api/whoami`),
  targets: () => jget<Targets>(`/api/targets`),
  addWeight: (weightKg: number, bodyFatPct?: number | null) =>
    jsend(`/api/weight`, "POST", { weightKg, bodyFatPct }),
  addMeasurement: (site: string, valueCm: number) =>
    jsend(`/api/measurements`, "POST", { site, valueCm }),
  putNutrition: (d: NutritionDay) => jsend(`/api/nutrition`, "PUT", d),
};

export const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local tz
