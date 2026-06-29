import { sql } from "drizzle-orm";
import { sqliteTable, integer, real, text } from "drizzle-orm/sqlite-core";

const nowMs = sql`(unixepoch() * 1000)`;

// Weight: the hero metric. BF% is from the scale's BIA — noisy, trend-only.
export const weightReadings = sqliteTable("weight_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(nowMs),
  weightKg: real("weight_kg").notNull(),
  bodyFatPct: real("body_fat_pct"),
  source: text("source", { enum: ["scale", "manual"] }).notNull().default("manual"),
  rawPayload: text("raw_payload"),
});

// Circumferences, one row per site per capture.
export const measurements = sqliteTable("measurements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(nowMs),
  site: text("site").notNull(), // shoulders|chest|arm_l|arm_r|waist|neck|thigh|custom
  valueCm: real("value_cm").notNull(),
  source: text("source", { enum: ["tape", "manual"] }).notNull().default("manual"),
});

export const photos = sqliteTable("photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(nowMs),
  r2Key: text("r2_key").notNull(),
  pose: text("pose", { enum: ["front", "side", "back"] }),
  notes: text("notes"),
});

export const targets = sqliteTable("targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goalWeightKg: real("goal_weight_kg"),
  targetDate: integer("target_date", { mode: "timestamp_ms" }),
  startWeightKg: real("start_weight_kg"),
  startDate: integer("start_date", { mode: "timestamp_ms" }),
  dailyKcalTarget: integer("daily_kcal_target").default(1850),
  proteinTargetG: integer("protein_target_g").default(160),
});

// Nutrition: strictly per-day (one lumped row per date). No meal breakdown.
export const nutritionDays = sqliteTable("nutrition_days", {
  date: text("date").primaryKey(), // YYYY-MM-DD
  kcal: integer("kcal"),
  proteinG: integer("protein_g"),
  hitProtein: integer("hit_protein", { mode: "boolean" }),
  adherence: text("adherence", { enum: ["under", "on", "over"] }),
});

// Hashed tokens for the scale-ingest endpoint (CF Access is exempted there).
export const ingestTokens = sqliteTable("ingest_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenHash: text("token_hash").notNull(),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});
