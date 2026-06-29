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
};

export type DashboardData = {
  weight: {
    latestKg: number | null;
    weeklyAvgKg: number | null;
    bodyFatPct: number | null;
    trend: { ts: number; kg: number }[];
  };
  targets: Targets;
  measurementsLatest: { site: string; valueCm: number; ts: number }[];
  shoulderToWaist: number | null;
  nutritionToday: NutritionDay | null;
};
