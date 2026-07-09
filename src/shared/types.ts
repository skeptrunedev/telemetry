// Shared between client and worker.

// Canonical storage is metric (kg, cm); the UI is imperial (lb, in).
export const LB_PER_KG = 2.2046226218;
export const CM_PER_IN = 2.54;
export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inch: number) => inch * CM_PER_IN;

export const MEASUREMENT_SITES = [
  "shoulders",
  "chest",
  "arm_l",
  "arm_r",
  "waist",
  "neck",
  "thigh",
  "glutes",
  "forearm_l",
  "forearm_r",
  "calf_l",
  "calf_r",
] as const;
export type MeasurementSite = (typeof MEASUREMENT_SITES)[number];

export const SITE_LABELS: Record<string, string> = {
  shoulders: "Shoulders",
  chest: "Chest",
  arm_l: "Arm (L)",
  arm_r: "Arm (R)",
  waist: "Waist",
  neck: "Neck",
  thigh: "Thigh",
  glutes: "Glutes",
  forearm_l: "Forearm (L)",
  forearm_r: "Forearm (R)",
  calf_l: "Calf (L)",
  calf_r: "Calf (R)",
};

export type Adherence = "under" | "on" | "over";

export type NutritionDay = {
  date: string; // YYYY-MM-DD
  kcal: number | null;
  proteinG: number | null;
  hitProtein: boolean | null;
  adherence: Adherence | null;
};

export type Targets = {
  goalWeightKg: number | null;
  startWeightKg: number | null;
  targetDate: number | null;
  startDate: number | null;
  dailyKcalTarget: number | null;
  proteinTargetG: number | null;
  heightCm: number | null;
  sex: "male" | "female" | "other" | null;
};

export type DashboardData = {
  weight: {
    latestKg: number | null;
    weeklyAvgKg: number | null;
    bodyFatPct: number | null;
    note: string | null;
    trend: { ts: number; kg: number }[];
  };
  targets: Targets;
  measurementsLatest: { site: string; valueCm: number; ts: number }[];
  shoulderToWaist: number | null;
  nutritionToday: NutritionDay | null;
};

// Fine-grained API-key scopes (resource:action). An API key holding the special
// "*" scope has full access; the UI defaults new keys to "*".
export const API_SCOPES = [
  "weight:read",
  "weight:write",
  "measurements:read",
  "measurements:write",
  "nutrition:read",
  "nutrition:write",
  "targets:read",
  "targets:write",
  "dashboard:read",
  "agent:read",
  "agent:write",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];
