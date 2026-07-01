import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import * as schema from "../db/schema";
import type { DashboardData, Targets } from "../shared/types";
// Generated from the @openapi JSDoc comments by scripts/gen-openapi.mjs
// (runs as the build's prebuild step). Served verbatim at /openapi.json.
import openapiDoc from "./openapi.gen.json";

type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  PHOTOS: R2Bucket;
  INGEST_TOKEN?: string;
  INGEST_USER_EMAIL?: string;
  ANTHROPIC_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const db = (c: { env: Bindings }) => drizzle(c.env.DB, { schema });

// Identity = the Cloudflare Access-verified email. Access sets this header on
// every request to the gated hostname (and sanitizes any client-supplied value);
// the *.workers.dev URL is disabled, so this is the only ingress. Local dev (no
// Access in front) falls back to a dev identity so the app still runs.
const userEmail = (c: { req: { header: (k: string) => string | undefined } }): string =>
  c.req.header("cf-access-authenticated-user-email")?.toLowerCase().trim() || "dev@local";

const DAY_MS = 86_400_000;
const DEFAULT_TARGETS = { goalWeightKg: 66.7, startWeightKg: 72.6, dailyKcalTarget: 1850, proteinTargetG: 160 };

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

const MACRO_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          kcal: { type: "integer" },
          protein_g: { type: "number" },
        },
        required: ["name", "kcal", "protein_g"],
        additionalProperties: false,
      },
    },
    total_kcal: { type: "integer" },
    total_protein_g: { type: "number" },
    note: { type: "string" },
  },
  required: ["items", "total_kcal", "total_protein_g", "note"],
  additionalProperties: false,
};

const VISION_PROMPT =
  "The image(s) show ONE meal, possibly from multiple angles. Identify each distinct food or drink and estimate its calories (kcal) and protein (grams) for the portion actually shown. Be realistic about portion size. Sum them into total_kcal and total_protein_g. In `note`, give one short sentence on key assumptions or uncertainty.";

const DESCRIBE_PROMPT =
  "The user describes a meal they ate, in their own words. Estimate each distinct food or drink they ACTUALLY ate — respect stated quantities, sides and sauces, and EXCLUDE anything they say they skipped, ignored, or left over. Give kcal and protein (grams) for each item's described portion, sum into total_kcal and total_protein_g, and in `note` state the main assumptions (portion sizes, restaurant defaults).";

// nutrition_days totals are derived from nutrition_items (SUM per user+date).
async function recomputeDay(c: { env: Bindings }, email: string, date: string) {
  const items = await db(c)
    .select()
    .from(schema.nutritionItems)
    .where(and(eq(schema.nutritionItems.userEmail, email), eq(schema.nutritionItems.date, date)));
  const kcal = items.length ? items.reduce((s, i) => s + (i.kcal ?? 0), 0) : null;
  const proteinG = items.length ? Math.round(items.reduce((s, i) => s + (i.proteinG ?? 0), 0)) : null;
  await db(c)
    .insert(schema.nutritionDays)
    .values({ userEmail: email, date, kcal, proteinG, hitProtein: proteinG != null ? proteinG >= 160 : null, adherence: null })
    .onConflictDoUpdate({
      target: [schema.nutritionDays.userEmail, schema.nutritionDays.date],
      set: { kcal, proteinG, hitProtein: proteinG != null ? proteinG >= 160 : null },
    });
}

/**
 * @openapi
 * /api/health:
 *   get:
 *     tags: [Service]
 *     summary: Liveness probe
 *     description: Returns a static payload confirming the Worker is up. Unauthenticated; used for uptime checks.
 *     operationId: getHealth
 *     security: []
 *     responses:
 *       '200':
 *         description: The service is healthy.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Health'
 */
app.get("/api/health", (c) => c.json({ ok: true, service: "telemetry", ts: new Date().toISOString() }));

/**
 * @openapi
 * /api/whoami:
 *   get:
 *     tags: [Service]
 *     summary: Resolve the current identity
 *     description: Returns the Cloudflare Access-verified email backing this session.
 *     operationId: whoami
 *     responses:
 *       '200':
 *         description: The resolved identity.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WhoAmI'
 */
app.get("/api/whoami", (c) => c.json({ email: userEmail(c) }));

// ---- weight ----------------------------------------------------------------
/**
 * @openapi
 * /api/weight:
 *   get:
 *     tags: [Weight]
 *     summary: List weigh-ins
 *     description: Returns up to 365 of the caller's most recent weight readings, newest first.
 *     operationId: listWeight
 *     responses:
 *       '200':
 *         description: Weight readings, newest first.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/WeightReading'
 */
app.get("/api/weight", async (c) => {
  const email = userEmail(c);
  const rows = await db(c)
    .select()
    .from(schema.weightReadings)
    .where(eq(schema.weightReadings.userEmail, email))
    .orderBy(desc(schema.weightReadings.ts), desc(schema.weightReadings.id))
    .limit(365);
  return c.json(rows.map((r) => ({ id: r.id, ts: r.ts.getTime(), weightKg: r.weightKg, bodyFatPct: r.bodyFatPct, note: r.note, source: r.source })));
});

/**
 * @openapi
 * /api/weight:
 *   post:
 *     tags: [Weight]
 *     summary: Log a weigh-in
 *     description: Records a manual body-weight reading for the caller.
 *     operationId: addWeight
 *     requestBody:
 *       required: true
 *       description: The weigh-in to record.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewWeight'
 *     responses:
 *       '200':
 *         description: The reading was stored.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */
app.post("/api/weight", async (c) => {
  const email = userEmail(c);
  const body = await c.req.json<{ weightKg?: number; bodyFatPct?: number | null; note?: string }>();
  if (typeof body.weightKg !== "number" || !isFinite(body.weightKg) || body.weightKg < 9 || body.weightKg > 320) {
    return c.json({ error: "weightKg must be 9–320 kg" }, 400);
  }
  if (body.bodyFatPct != null && (body.bodyFatPct < 1 || body.bodyFatPct > 80)) {
    return c.json({ error: "bodyFatPct must be 1–80" }, 400);
  }
  await db(c).insert(schema.weightReadings).values({
    userEmail: email,
    weightKg: body.weightKg,
    bodyFatPct: body.bodyFatPct ?? null,
    note: body.note ? String(body.note).slice(0, 500) : null,
    source: "manual",
  });
  return c.json({ ok: true });
});

// Edit the note on any past weigh-in (scoped to the user).
/**
 * @openapi
 * /api/weight/{id}:
 *   patch:
 *     tags: [Weight]
 *     summary: Edit a weigh-in note
 *     description: Updates or clears the note on one of the caller's past readings.
 *     operationId: updateWeightNote
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Weight-reading identifier.
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       description: The new note value, or null to clear it.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WeightNote'
 *     responses:
 *       '200':
 *         description: The note was updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.patch("/api/weight/:id", async (c) => {
  const email = userEmail(c);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
  const b = await c.req.json<{ note?: string | null }>();
  const note = b.note ? String(b.note).slice(0, 500) : null;
  const rows = await db(c)
    .select()
    .from(schema.weightReadings)
    .where(and(eq(schema.weightReadings.id, id), eq(schema.weightReadings.userEmail, email)))
    .limit(1);
  if (!rows.length) return c.json({ error: "not found" }, 404);
  await db(c)
    .update(schema.weightReadings)
    .set({ note })
    .where(and(eq(schema.weightReadings.id, id), eq(schema.weightReadings.userEmail, email)));
  return c.json({ ok: true });
});

// ---- measurements ----------------------------------------------------------
/**
 * @openapi
 * /api/measurements:
 *   get:
 *     tags: [Measurements]
 *     summary: List measurements
 *     description: Returns up to 500 of the caller's measurements, newest first.
 *     operationId: listMeasurements
 *     responses:
 *       '200':
 *         description: Measurements, newest first.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Measurement'
 */
app.get("/api/measurements", async (c) => {
  const email = userEmail(c);
  const rows = await db(c)
    .select()
    .from(schema.measurements)
    .where(eq(schema.measurements.userEmail, email))
    .orderBy(desc(schema.measurements.ts), desc(schema.measurements.id))
    .limit(500);
  return c.json(rows.map((r) => ({ id: r.id, ts: r.ts.getTime(), site: r.site, valueCm: r.valueCm, source: r.source })));
});

/**
 * @openapi
 * /api/measurements:
 *   post:
 *     tags: [Measurements]
 *     summary: Record a measurement
 *     description: Stores a body-part circumference measurement for the caller.
 *     operationId: addMeasurement
 *     requestBody:
 *       required: true
 *       description: The measurement to record.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewMeasurement'
 *     responses:
 *       '200':
 *         description: The measurement was stored.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */
app.post("/api/measurements", async (c) => {
  const email = userEmail(c);
  const body = await c.req.json<{ site?: string; valueCm?: number }>();
  if (!body.site || typeof body.valueCm !== "number" || !isFinite(body.valueCm) || body.valueCm < 1 || body.valueCm > 300) {
    return c.json({ error: "site + valueCm (1–300 cm) required" }, 400);
  }
  await db(c).insert(schema.measurements).values({ userEmail: email, site: body.site, valueCm: body.valueCm, source: "manual" });
  return c.json({ ok: true });
});

// ---- nutrition (per-day upsert) --------------------------------------------
/**
 * @openapi
 * /api/nutrition:
 *   get:
 *     tags: [Nutrition]
 *     summary: List daily totals
 *     description: Returns up to 60 of the caller's most recent daily nutrition roll-ups, newest first.
 *     operationId: listNutritionDays
 *     responses:
 *       '200':
 *         description: Daily nutrition totals, newest first.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/NutritionDay'
 */
app.get("/api/nutrition", async (c) => {
  const email = userEmail(c);
  const rows = await db(c)
    .select()
    .from(schema.nutritionDays)
    .where(eq(schema.nutritionDays.userEmail, email))
    .orderBy(desc(schema.nutritionDays.date))
    .limit(60);
  return c.json(rows);
});

/**
 * @openapi
 * /api/nutrition:
 *   put:
 *     tags: [Nutrition]
 *     summary: Upsert a day's totals
 *     description: Directly sets the calorie and protein totals for one calendar day, replacing any existing roll-up.
 *     operationId: upsertNutritionDay
 *     requestBody:
 *       required: true
 *       description: The day's totals to store.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NutritionDayInput'
 *     responses:
 *       '200':
 *         description: The day's totals were stored.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 */
app.put("/api/nutrition", async (c) => {
  const email = userEmail(c);
  const b = await c.req.json<{ date?: string; kcal?: number | null; proteinG?: number | null; hitProtein?: boolean | null; adherence?: "under" | "on" | "over" | null }>();
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return c.json({ error: "date (YYYY-MM-DD) required" }, 400);
  if (b.kcal != null && (b.kcal < 0 || b.kcal > 20000)) return c.json({ error: "kcal must be 0–20000" }, 400);
  if (b.proteinG != null && (b.proteinG < 0 || b.proteinG > 1000)) return c.json({ error: "proteinG must be 0–1000" }, 400);
  const values = { userEmail: email, date: b.date, kcal: b.kcal ?? null, proteinG: b.proteinG ?? null, hitProtein: b.hitProtein ?? null, adherence: b.adherence ?? null };
  await db(c)
    .insert(schema.nutritionDays)
    .values(values)
    .onConflictDoUpdate({ target: [schema.nutritionDays.userEmail, schema.nutritionDays.date], set: values });
  return c.json({ ok: true });
});

// ---- targets (one row per user) --------------------------------------------
async function getTargets(c: { env: Bindings }, email: string): Promise<Targets & { id: number }> {
  const existing = await db(c).select().from(schema.targets).where(eq(schema.targets.userEmail, email)).limit(1);
  const t =
    existing[0] ??
    (await db(c).insert(schema.targets).values({ userEmail: email, ...DEFAULT_TARGETS, startDate: new Date() }).returning())[0];
  return {
    id: t.id,
    goalWeightKg: t.goalWeightKg,
    startWeightKg: t.startWeightKg,
    targetDate: t.targetDate ? t.targetDate.getTime() : null,
    startDate: t.startDate ? t.startDate.getTime() : null,
    dailyKcalTarget: t.dailyKcalTarget,
    proteinTargetG: t.proteinTargetG,
  };
}

/**
 * @openapi
 * /api/targets:
 *   get:
 *     tags: [Targets]
 *     summary: Get goals
 *     description: Returns the caller's targets, creating a default row on first access.
 *     operationId: getTargets
 *     responses:
 *       '200':
 *         description: The caller's targets.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Targets'
 */
app.get("/api/targets", async (c) => c.json(await getTargets(c, userEmail(c))));

/**
 * @openapi
 * /api/targets:
 *   put:
 *     tags: [Targets]
 *     summary: Update goals
 *     description: Partially updates the caller's targets; omitted fields are left unchanged.
 *     operationId: updateTargets
 *     requestBody:
 *       required: true
 *       description: The fields to change; omitted fields are left unchanged.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TargetsInput'
 *     responses:
 *       '200':
 *         description: The targets were updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 */
app.put("/api/targets", async (c) => {
  const email = userEmail(c);
  const b = await c.req.json<Partial<Targets>>();
  const current = await getTargets(c, email);
  await db(c)
    .update(schema.targets)
    .set({
      goalWeightKg: b.goalWeightKg ?? current.goalWeightKg,
      startWeightKg: b.startWeightKg ?? current.startWeightKg,
      dailyKcalTarget: b.dailyKcalTarget ?? current.dailyKcalTarget,
      proteinTargetG: b.proteinTargetG ?? current.proteinTargetG,
      targetDate: b.targetDate ? new Date(b.targetDate) : undefined,
    })
    .where(eq(schema.targets.userEmail, email));
  return c.json({ ok: true });
});

// ---- dashboard aggregate ---------------------------------------------------
/**
 * @openapi
 * /api/dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: Home-screen snapshot
 *     description: Returns the weight summary, targets, latest measurements, shoulder-to-waist ratio, and the given day's nutrition in one response.
 *     operationId: getDashboard
 *     parameters:
 *       - name: date
 *         in: query
 *         required: false
 *         description: Day to report nutrition for (YYYY-MM-DD). Defaults to the server's current UTC date.
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       '200':
 *         description: The dashboard snapshot.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardData'
 */
app.get("/api/dashboard", async (c) => {
  const email = userEmail(c);
  const today = c.req.query("date") ?? new Date().toISOString().slice(0, 10);

  const weightRows = await db(c)
    .select()
    .from(schema.weightReadings)
    .where(eq(schema.weightReadings.userEmail, email))
    .orderBy(desc(schema.weightReadings.ts), desc(schema.weightReadings.id))
    .limit(120);
  const trend = weightRows.map((r) => ({ ts: r.ts.getTime(), kg: r.weightKg })).reverse();
  const latest = weightRows[0] ?? null;
  const weekCut = Date.now() - 7 * DAY_MS;
  const lastWeek = weightRows.filter((r) => r.ts.getTime() >= weekCut);
  const weeklyAvgKg = lastWeek.length ? lastWeek.reduce((s, r) => s + r.weightKg, 0) / lastWeek.length : null;

  const mRows = await db(c)
    .select()
    .from(schema.measurements)
    .where(eq(schema.measurements.userEmail, email))
    .orderBy(desc(schema.measurements.ts), desc(schema.measurements.id))
    .limit(500);
  const seen = new Set<string>();
  const measurementsLatest: { site: string; valueCm: number; ts: number }[] = [];
  for (const m of mRows) {
    if (seen.has(m.site)) continue;
    seen.add(m.site);
    measurementsLatest.push({ site: m.site, valueCm: m.valueCm, ts: m.ts.getTime() });
  }
  const shoulders = measurementsLatest.find((m) => m.site === "shoulders")?.valueCm;
  const waist = measurementsLatest.find((m) => m.site === "waist")?.valueCm;
  const shoulderToWaist = shoulders && waist ? shoulders / waist : null;

  const nutToday = await db(c)
    .select()
    .from(schema.nutritionDays)
    .where(and(eq(schema.nutritionDays.userEmail, email), eq(schema.nutritionDays.date, today)))
    .limit(1);

  const targets = await getTargets(c, email);
  const data: DashboardData = {
    weight: { latestKg: latest?.weightKg ?? null, weeklyAvgKg, bodyFatPct: latest?.bodyFatPct ?? null, note: latest?.note ?? null, trend },
    targets,
    measurementsLatest,
    shoulderToWaist,
    nutritionToday: nutToday[0] ?? null,
  };
  return c.json(data);
});

// ---- scale ingest (token-auth; attributed to a configured user) ------------
/**
 * @openapi
 * /api/ingest/weight:
 *   post:
 *     tags: [Ingest]
 *     summary: Ingest a scale reading
 *     description: Machine endpoint for the Bluetooth scale listener. Authenticated with the ingest bearer token and attributed to a configured owner rather than the Access identity.
 *     operationId: ingestWeight
 *     security:
 *       - ingestToken: []
 *     requestBody:
 *       required: true
 *       description: The scale reading to ingest.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/IngestWeight'
 *     responses:
 *       '200':
 *         description: The scale reading was ingested and stored.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '503':
 *         $ref: '#/components/responses/ServiceUnavailable'
 */
app.post("/api/ingest/weight", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!c.env.INGEST_TOKEN) return c.json({ error: "ingest not configured" }, 503);
  if (token !== c.env.INGEST_TOKEN) return c.json({ error: "unauthorized" }, 401);
  const b = await c.req.json<{ weightKg?: number; bodyFatPct?: number | null; userEmail?: string; raw?: unknown }>();
  const owner = (b.userEmail ?? c.env.INGEST_USER_EMAIL)?.toLowerCase().trim();
  if (!owner) return c.json({ error: "no ingest user configured" }, 503);
  if (typeof b.weightKg !== "number" || !isFinite(b.weightKg) || b.weightKg < 9 || b.weightKg > 320) {
    return c.json({ error: "weightKg out of range" }, 400);
  }
  await db(c).insert(schema.weightReadings).values({
    userEmail: owner,
    weightKg: b.weightKg,
    bodyFatPct: b.bodyFatPct ?? null,
    source: "scale",
    rawPayload: b.raw ? JSON.stringify(b.raw) : null,
  });
  return c.json({ ok: true });
});

// ---- nutrition: photo -> Claude vision -> macros ---------------------------
/**
 * @openapi
 * /api/nutrition/analyze:
 *   post:
 *     tags: [Nutrition]
 *     summary: Log a meal from photos
 *     description: Uploads 1–5 photos of a single meal, sends them to Claude vision for per-item calorie and protein estimates, stores the photos plus a meal, and returns the analysis.
 *     operationId: analyzeMeal
 *     parameters:
 *       - name: date
 *         in: query
 *         required: false
 *         description: Day to log against (YYYY-MM-DD). Defaults to the server's current UTC date.
 *         schema:
 *           type: string
 *           format: date
 *     requestBody:
 *       required: true
 *       description: The meal photos to analyze, as multipart form fields named `photos`.
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [photos]
 *             properties:
 *               photos:
 *                 type: array
 *                 description: 1–5 photos of a single meal, possibly from multiple angles (JPEG, PNG, WebP, or GIF; max 8MB each).
 *                 example: ["@plate.jpg", "@plate-side.jpg"]
 *                 items:
 *                   type: string
 *                   format: binary
 *                   example: "@plate.jpg"
 *     responses:
 *       '200':
 *         description: The meal was analyzed and logged.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MealAnalysis'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '502':
 *         $ref: '#/components/responses/BadGateway'
 *       '503':
 *         $ref: '#/components/responses/ServiceUnavailable'
 */
app.post("/api/nutrition/analyze", async (c) => {
  const email = userEmail(c);
  const today = c.req.query("date") ?? new Date().toISOString().slice(0, 10);

  const form = await c.req.formData();
  type UploadFile = { type: string; arrayBuffer: () => Promise<ArrayBuffer> };
  const isFile = (f: unknown): f is UploadFile =>
    typeof f === "object" && f !== null && typeof (f as UploadFile).arrayBuffer === "function";
  const files = (form.getAll("photos") as unknown[]).filter(isFile);
  if (!files.length) return c.json({ error: "no photos uploaded" }, 400);
  if (files.length > 5) return c.json({ error: "max 5 photos per meal" }, 400);
  // Validate types/sizes before we touch R2 or the model.
  const bufs: { mt: string; buf: ArrayBuffer }[] = [];
  for (const file of files) {
    const mt = file.type || "image/jpeg";
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mt)) return c.json({ error: `unsupported image type ${mt}` }, 400);
    const buf = await file.arrayBuffer();
    if (buf.byteLength > 8_000_000) return c.json({ error: "image too large (max 8MB)" }, 400);
    bufs.push({ mt, buf });
  }
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "vision not configured" }, 503);

  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  const photoKeys: string[] = [];
  for (const { mt, buf } of bufs) {
    const key = `${email}/${today}/${crypto.randomUUID()}`;
    await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: mt } });
    photoKeys.push(key);
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: mt as "image/jpeg", data: bufToBase64(buf) },
    });
  }

  const anthropic = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  type Macro = { items: { name: string; kcal: number; protein_g: number }[]; total_kcal: number; total_protein_g: number; note: string };
  let parsed: Macro;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      output_config: { format: { type: "json_schema", schema: MACRO_SCHEMA } },
      messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: VISION_PROMPT }] }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const out = msg.content.filter((bk) => bk.type === "text").map((bk) => (bk as Anthropic.TextBlock).text).join("");
    parsed = JSON.parse(out);
  } catch (e) {
    return c.json({ error: "analysis failed", detail: String(e) }, 502);
  }

  const mealId = crypto.randomUUID();
  await db(c).insert(schema.meals).values({
    id: mealId, userEmail: email, date: today, note: parsed.note ?? null, photoKeys: JSON.stringify(photoKeys),
  });
  const items = (parsed.items ?? []).slice(0, 30).map((it) => ({
    userEmail: email, mealId, date: today,
    name: String(it.name).slice(0, 120),
    kcal: Math.max(0, Math.round(Number(it.kcal) || 0)),
    proteinG: Math.max(0, Number(it.protein_g) || 0),
    source: "ai" as const,
  }));
  if (items.length) await db(c).insert(schema.nutritionItems).values(items);
  await recomputeDay(c, email, today);

  return c.json({
    ok: true,
    mealId,
    items: items.map((i) => ({ name: i.name, kcal: i.kcal, proteinG: i.proteinG })),
    totalKcal: items.reduce((s, i) => s + i.kcal, 0),
    totalProteinG: Math.round(items.reduce((s, i) => s + i.proteinG, 0)),
    note: parsed.note,
    photoKeys,
  });
});

// ---- nutrition: text description -> Claude -> macros ------------------------
/**
 * @openapi
 * /api/nutrition/describe:
 *   post:
 *     tags: [Nutrition]
 *     summary: Log a meal from a description
 *     description: Sends a freeform meal description to Claude for per-item calorie and protein estimates, respecting stated portions and excluding anything the user says they skipped, then stores it as a meal.
 *     operationId: describeMeal
 *     parameters:
 *       - name: date
 *         in: query
 *         required: false
 *         description: Day to log the described meal against (YYYY-MM-DD). Defaults to the server's current UTC date.
 *         schema:
 *           type: string
 *           format: date
 *     requestBody:
 *       required: true
 *       description: The freeform meal description to analyze.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DescribeMeal'
 *     responses:
 *       '200':
 *         description: The meal description was analyzed and logged.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MealAnalysis'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '502':
 *         $ref: '#/components/responses/BadGateway'
 *       '503':
 *         $ref: '#/components/responses/ServiceUnavailable'
 */
app.post("/api/nutrition/describe", async (c) => {
  const email = userEmail(c);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "ai not configured" }, 503);
  const today = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const b = await c.req.json<{ text?: string }>();
  const text = (b.text ?? "").trim().slice(0, 2000);
  if (!text) return c.json({ error: "describe what you ate" }, 400);

  const anthropic = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  type Macro = { items: { name: string; kcal: number; protein_g: number }[]; total_kcal: number; total_protein_g: number; note: string };
  let parsed: Macro;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      output_config: { format: { type: "json_schema", schema: MACRO_SCHEMA } },
      messages: [{ role: "user", content: `${DESCRIBE_PROMPT}\n\nMeal: ${text}` }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const out = msg.content.filter((bk) => bk.type === "text").map((bk) => (bk as Anthropic.TextBlock).text).join("");
    parsed = JSON.parse(out);
  } catch (e) {
    return c.json({ error: "analysis failed", detail: String(e) }, 502);
  }

  const mealId = crypto.randomUUID();
  await db(c).insert(schema.meals).values({ id: mealId, userEmail: email, date: today, note: text, photoKeys: null });
  const items = (parsed.items ?? []).slice(0, 30).map((it) => ({
    userEmail: email, mealId, date: today,
    name: String(it.name).slice(0, 120),
    kcal: Math.max(0, Math.round(Number(it.kcal) || 0)),
    proteinG: Math.max(0, Number(it.protein_g) || 0),
    source: "ai" as const,
  }));
  if (items.length) await db(c).insert(schema.nutritionItems).values(items);
  await recomputeDay(c, email, today);

  return c.json({
    ok: true,
    mealId,
    items: items.map((i) => ({ name: i.name, kcal: i.kcal, proteinG: i.proteinG })),
    totalKcal: items.reduce((s, i) => s + i.kcal, 0),
    totalProteinG: Math.round(items.reduce((s, i) => s + i.proteinG, 0)),
    note: parsed.note,
  });
});

/**
 * @openapi
 * /api/nutrition/meals:
 *   get:
 *     tags: [Nutrition]
 *     summary: List meals for a day
 *     description: Returns the caller's logged meals for a day, each with its food items, newest first.
 *     operationId: listMeals
 *     parameters:
 *       - name: date
 *         in: query
 *         required: false
 *         description: Day to list (YYYY-MM-DD). Defaults to the server's current UTC date.
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       '200':
 *         description: Meals for the day, newest first.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Meal'
 */
app.get("/api/nutrition/meals", async (c) => {
  const email = userEmail(c);
  const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const mealRows = await db(c)
    .select()
    .from(schema.meals)
    .where(and(eq(schema.meals.userEmail, email), eq(schema.meals.date, date)))
    .orderBy(desc(schema.meals.createdAt));
  const itemRows = await db(c)
    .select()
    .from(schema.nutritionItems)
    .where(and(eq(schema.nutritionItems.userEmail, email), eq(schema.nutritionItems.date, date)));
  return c.json(
    mealRows.map((m) => ({
      id: m.id,
      note: m.note,
      createdAt: m.createdAt.getTime(),
      photoKeys: m.photoKeys ? (JSON.parse(m.photoKeys) as string[]) : [],
      items: itemRows.filter((i) => i.mealId === m.id).map((i) => ({ id: i.id, name: i.name, kcal: i.kcal, proteinG: i.proteinG })),
    })),
  );
});

/**
 * @openapi
 * /api/nutrition/meals/{id}:
 *   delete:
 *     tags: [Nutrition]
 *     summary: Delete a meal
 *     description: Removes one of the caller's meals, its food items, and any stored photos, then recomputes the day's totals.
 *     operationId: deleteMeal
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Meal identifier (UUID).
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       '200':
 *         description: The meal was deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.delete("/api/nutrition/meals/:id", async (c) => {
  const email = userEmail(c);
  const id = c.req.param("id");
  const rows = await db(c).select().from(schema.meals).where(and(eq(schema.meals.id, id), eq(schema.meals.userEmail, email))).limit(1);
  if (!rows.length) return c.json({ error: "not found" }, 404);
  const keys: string[] = rows[0].photoKeys ? JSON.parse(rows[0].photoKeys) : [];
  await Promise.all(keys.map((k) => c.env.PHOTOS.delete(k).catch(() => {})));
  await db(c).delete(schema.nutritionItems).where(and(eq(schema.nutritionItems.mealId, id), eq(schema.nutritionItems.userEmail, email)));
  await db(c).delete(schema.meals).where(and(eq(schema.meals.id, id), eq(schema.meals.userEmail, email)));
  await recomputeDay(c, email, rows[0].date);
  return c.json({ ok: true });
});

// Remove a single logged food item.
/**
 * @openapi
 * /api/nutrition/items/{id}:
 *   delete:
 *     tags: [Nutrition]
 *     summary: Delete a food item
 *     description: Removes a single logged food item and recomputes the affected day's totals.
 *     operationId: deleteItem
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Food-item identifier.
 *         schema:
 *           type: integer
 *     responses:
 *       '200':
 *         description: The item was deleted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Ok'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
app.delete("/api/nutrition/items/:id", async (c) => {
  const email = userEmail(c);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
  const rows = await db(c).select().from(schema.nutritionItems).where(and(eq(schema.nutritionItems.id, id), eq(schema.nutritionItems.userEmail, email))).limit(1);
  if (!rows.length) return c.json({ error: "not found" }, 404);
  await db(c).delete(schema.nutritionItems).where(and(eq(schema.nutritionItems.id, id), eq(schema.nutritionItems.userEmail, email)));
  await recomputeDay(c, email, rows[0].date);
  return c.json({ ok: true });
});

// Serve a meal photo from R2, scoped to the requesting user's own keys.
/**
 * @openapi
 * /api/nutrition/photo/{key}:
 *   get:
 *     tags: [Nutrition]
 *     summary: Fetch a meal photo
 *     description: Streams a stored meal photo from object storage. The key is owner-prefixed, so callers can only read their own photos. Note that the key contains slashes.
 *     operationId: getMealPhoto
 *     parameters:
 *       - name: key
 *         in: path
 *         required: true
 *         description: Owner-prefixed object key, e.g. `user@example.com/2026-06-29/<uuid>`.
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: The image bytes.
 *         content:
 *           image/jpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         description: No photo exists at that key.
 */
app.get("/api/nutrition/photo/*", async (c) => {
  const email = userEmail(c);
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/nutrition\/photo\//, ""));
  if (!key.startsWith(`${email}/`)) return c.json({ error: "forbidden" }, 403);
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=86400" },
  });
});

// ---- OpenAPI document ------------------------------------------------------
/**
 * @openapi
 * /openapi.json:
 *   get:
 *     tags: [Spec]
 *     summary: OpenAPI document
 *     description: The machine-readable OpenAPI 3.1 description of this API, generated from in-code comments.
 *     operationId: getOpenapi
 *     security: []
 *     responses:
 *       '200':
 *         description: The OpenAPI document.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *               example: { openapi: "3.1.0", info: { title: telemetry, version: "1.0.0" }, paths: {} }
 */
app.get("/openapi.json", (c) =>
  c.json(openapiDoc as Record<string, unknown>, 200, { "cache-control": "public, max-age=300" }),
);

// ---- CLI login bounce ------------------------------------------------------
// The CLI opens this URL in a browser. It sits behind Cloudflare Access, so the
// visit forces SSO; afterwards Access hands us the verified app token (the
// CF_Authorization cookie / the Cf-Access-Jwt-Assertion header). We bounce that
// token back to the one-shot localhost server the CLI is listening on. The CLI
// then replays it as the `cf-access-token` header — no API key involved.
//
// Security: we only ever redirect to loopback (127.0.0.1:<port>), so the token
// can never be exfiltrated to an attacker-controlled host via a crafted link.
function accessToken(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const cookie = c.req.header("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return c.req.header("cf-access-jwt-assertion") ?? null;
}

/**
 * @openapi
 * /cli-auth:
 *   get:
 *     tags: [Auth]
 *     summary: CLI login bounce
 *     description: Behind Cloudflare Access; after SSO it redirects the verified Access token back to the CLI's local loopback callback. Not called directly by users.
 *     operationId: cliAuth
 *     parameters:
 *       - name: port
 *         in: query
 *         required: true
 *         description: Loopback port the CLI's one-shot callback server is listening on.
 *         schema:
 *           type: integer
 *           minimum: 1024
 *           maximum: 65535
 *       - name: state
 *         in: query
 *         required: true
 *         description: Opaque nonce the CLI generated, echoed back so it can reject unsolicited callbacks.
 *         schema:
 *           type: string
 *     responses:
 *       '302':
 *         description: Redirect to the CLI's loopback callback carrying the Access token.
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 */
app.get("/cli-auth", (c) => {
  const port = Number(c.req.query("port"));
  const state = c.req.query("state") ?? "";
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !state || state.length > 200) {
    return c.json({ error: "bad port or state" }, 400);
  }
  const token = accessToken(c);
  if (!token) return c.json({ error: "no access token on request" }, 401);
  const url = `http://127.0.0.1:${port}/callback?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
  return c.redirect(url, 302);
});

// ---- SPA fallback ----------------------------------------------------------
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
