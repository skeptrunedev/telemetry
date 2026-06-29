import { sql } from "drizzle-orm";
import { sqliteTable, integer, real, text, primaryKey } from "drizzle-orm/sqlite-core";

const nowMs = sql`(unixepoch() * 1000)`;

// Every row is owned by the Cloudflare Access-verified email (user_email).
// All queries are scoped by it, so users only ever see their own data.

export const weightReadings = sqliteTable("weight_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().default(""),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(nowMs),
  weightKg: real("weight_kg").notNull(),
  bodyFatPct: real("body_fat_pct"),
  note: text("note"),
  source: text("source", { enum: ["scale", "manual"] }).notNull().default("manual"),
  rawPayload: text("raw_payload"),
});

export const measurements = sqliteTable("measurements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().default(""),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(nowMs),
  site: text("site").notNull(), // shoulders|chest|arm_l|arm_r|waist|neck|thigh|custom
  valueCm: real("value_cm").notNull(),
  source: text("source", { enum: ["tape", "manual"] }).notNull().default("manual"),
});

export const photos = sqliteTable("photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().default(""),
  ts: integer("ts", { mode: "timestamp_ms" }).notNull().default(nowMs),
  r2Key: text("r2_key").notNull(),
  pose: text("pose", { enum: ["front", "side", "back"] }),
  notes: text("notes"),
});

// One targets row per user.
export const targets = sqliteTable("targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().unique(),
  goalWeightKg: real("goal_weight_kg"),
  targetDate: integer("target_date", { mode: "timestamp_ms" }),
  startWeightKg: real("start_weight_kg"),
  startDate: integer("start_date", { mode: "timestamp_ms" }),
  dailyKcalTarget: integer("daily_kcal_target").default(1850),
  proteinTargetG: integer("protein_target_g").default(160),
});

// Per-day nutrition, one row per (user, date).
export const nutritionDays = sqliteTable(
  "nutrition_days",
  {
    userEmail: text("user_email").notNull().default(""),
    date: text("date").notNull(), // YYYY-MM-DD
    kcal: integer("kcal"),
    proteinG: integer("protein_g"),
    hitProtein: integer("hit_protein", { mode: "boolean" }),
    adherence: text("adherence", { enum: ["under", "on", "over"] }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userEmail, t.date] }) }),
);

// A logged meal: one AI photo-analysis (or manual add). Photos live in R2.
export const meals = sqliteTable("meals", {
  id: text("id").primaryKey(), // uuid
  userEmail: text("user_email").notNull().default(""),
  date: text("date").notNull(), // YYYY-MM-DD
  note: text("note"),
  photoKeys: text("photo_keys"), // JSON array of R2 object keys
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

// Per-food line items; SUM per (user, date) rolls up into nutrition_days.
export const nutritionItems = sqliteTable("nutrition_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull().default(""),
  mealId: text("meal_id"),
  date: text("date").notNull(),
  name: text("name").notNull(),
  kcal: integer("kcal").notNull(),
  proteinG: real("protein_g").notNull(),
  source: text("source", { enum: ["ai", "manual"] }).notNull().default("ai"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const ingestTokens = sqliteTable("ingest_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email"),
  tokenHash: text("token_hash").notNull(),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});
