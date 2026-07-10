// Apple Health (HealthKit) sync — phase 1.
//
// iOS-only by nature. Every entry point is guarded twice: Platform.OS must be
// "ios" AND the native module must actually load (try/require), so the web sim,
// Android builds, and Expo Go — where @kingstinct/react-native-healthkit's
// native side is absent — never crash.
//
// Sync model: on app open and pull-to-refresh, once connected. We persist a
// per-stream timestamp anchor in SecureStore and only advance it after a
// sample's POST succeeds, so a mid-run failure re-syncs the remainder instead
// of dropping it, and nothing is ever posted twice.
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { logWeight, describeWorkout } from "./api";

type HK = typeof import("@kingstinct/react-native-healthkit");

const CONNECTED_KEY = "skcal_health_connected";
const WEIGHT_ANCHOR_KEY = "skcal_health_weight_synced_ms";
const WORKOUT_ANCHOR_KEY = "skcal_health_workout_synced_ms";
const DAY_MS = 86_400_000;
// First-connect look-back windows: enough weight history to seed the trend,
// but a short workout window since each workout costs a parse call server-side.
const WEIGHT_BACKFILL_MS = 30 * DAY_MS;
const WORKOUT_BACKFILL_MS = 7 * DAY_MS;
// Per-run caps keep a pathological backlog from hammering the API; the anchor
// only advances past what was posted, so the rest flows in on the next sync.
const MAX_WEIGHTS_PER_SYNC = 50;
const MAX_WORKOUTS_PER_SYNC = 20;

let mod: HK | null | undefined;
function hk(): HK | null {
  if (Platform.OS !== "ios") return null;
  if (mod === undefined) {
    try {
      mod = require("@kingstinct/react-native-healthkit") as HK;
    } catch {
      mod = null;
    }
  }
  return mod;
}

// True when we're on iOS and the native module loaded (i.e. a dev/EAS build,
// not Expo Go or the web export).
export function healthSupported(): boolean {
  return hk() != null;
}

export async function isHealthConnected(): Promise<boolean> {
  if (!healthSupported()) return false;
  try {
    return (await SecureStore.getItemAsync(CONNECTED_KEY)) === "1";
  } catch {
    return false;
  }
}

// Show the HealthKit permission sheet and persist the connected flag.
// Note: HealthKit never reveals whether READ access was granted (by design),
// so a resolved request is our best signal; if the user denied everything the
// queries simply come back empty.
export async function connectAppleHealth(): Promise<boolean> {
  const m = hk();
  if (!m) return false;
  if (!m.isHealthDataAvailable()) return false;
  const ok = await m.requestAuthorization({
    toRead: ["HKQuantityTypeIdentifierBodyMass", "HKWorkoutTypeIdentifier"],
  });
  if (!ok) return false;
  const now = Date.now();
  await SecureStore.setItemAsync(WEIGHT_ANCHOR_KEY, String(now - WEIGHT_BACKFILL_MS));
  await SecureStore.setItemAsync(WORKOUT_ANCHOR_KEY, String(now - WORKOUT_BACKFILL_MS));
  await SecureStore.setItemAsync(CONNECTED_KEY, "1");
  return true;
}

// Pull new samples since each anchor and log them. Returns what was posted,
// or null when not connected / not supported. Each stream fails independently
// so a workout-parse hiccup doesn't block weight syncing.
export async function syncAppleHealth(): Promise<{ weights: number; workouts: number } | null> {
  const m = hk();
  if (!m || !(await isHealthConnected())) return null;
  const result = { weights: 0, workouts: 0 };
  try {
    result.weights = await syncWeights(m);
  } catch {
    // leave the anchor where the last successful post put it; retry next sync
  }
  try {
    result.workouts = await syncWorkouts(m);
  } catch {
    // same: next sync resumes from the last posted sample
  }
  return result;
}

async function readAnchor(key: string, fallbackMs: number): Promise<number> {
  const raw = await SecureStore.getItemAsync(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Date.now() - fallbackMs;
}

async function syncWeights(m: HK): Promise<number> {
  const since = await readAnchor(WEIGHT_ANCHOR_KEY, WEIGHT_BACKFILL_MS);
  const samples = await m.queryQuantitySamples("HKQuantityTypeIdentifierBodyMass", {
    filter: { date: { startDate: new Date(since + 1) } },
    unit: "kg",
    ascending: true,
    limit: MAX_WEIGHTS_PER_SYNC,
  });
  let posted = 0;
  for (const s of samples) {
    const ts = new Date(s.endDate).getTime();
    if (!(ts > since)) continue; // already synced on a previous run
    // Mirrors the worker's validation range so we never burn a request on a 400.
    if (s.quantity >= 9 && s.quantity <= 320) {
      await logWeight(round1(s.quantity), "from Apple Health");
      posted++;
    }
    // ascending order ⇒ the anchor advances monotonically, after the post
    await SecureStore.setItemAsync(WEIGHT_ANCHOR_KEY, String(ts));
  }
  return posted;
}

async function syncWorkouts(m: HK): Promise<number> {
  const since = await readAnchor(WORKOUT_ANCHOR_KEY, WORKOUT_BACKFILL_MS);
  const workouts = await m.queryWorkoutSamples({
    filter: { date: { startDate: new Date(since + 1) } },
    ascending: true,
    limit: MAX_WORKOUTS_PER_SYNC,
  });
  let posted = 0;
  for (const w of workouts) {
    const ts = new Date(w.endDate).getTime();
    if (!(ts > since)) continue;
    const mins = Math.round((w.duration?.quantity ?? 0) / 60);
    if (mins < 1) {
      await SecureStore.setItemAsync(WORKOUT_ANCHOR_KEY, String(ts));
      continue; // zero-length artifacts aren't worth a log entry
    }
    const kcal = w.totalEnergyBurned ? Math.round(w.totalEnergyBurned.quantity) : 0;
    const name = activityName(m, w.workoutActivityType);
    const text = `${name}, ${mins} min${kcal > 0 ? `, ${kcal} kcal` : ""} (Apple Health)`;
    await describeWorkout(text, new Date(w.startDate).toLocaleDateString("en-CA"));
    posted++;
    await SecureStore.setItemAsync(WORKOUT_ANCHOR_KEY, String(ts));
  }
  return posted;
}

// WorkoutActivityType is a numeric enum: reverse-map the value to its key and
// humanize it — traditionalStrengthTraining → "Traditional strength training".
function activityName(m: HK, type: number): string {
  const key = (m.WorkoutActivityType as Record<number, string | undefined>)[type];
  if (!key) return "Workout";
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
