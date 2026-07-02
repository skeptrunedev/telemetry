import { Hono } from "hono";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import * as schema from "../db/schema";
import { makeAuth } from "./auth";
import { oAuthDiscoveryMetadata, oAuthProtectedResourceMetadata } from "better-auth/plugins";
import type { DashboardData, Targets } from "../shared/types";
import { lbToKg, inToCm, MEASUREMENT_SITES } from "../shared/types";
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
  // ---- Better Auth (self-hosted auth, replacing Cloudflare Access) ----
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  // When set (local dev + tests), unauthenticated requests fall back to a dev
  // identity instead of being rejected. Unset in production ⇒ 401.
  AUTH_DEV_BYPASS?: string;
};

type Variables = { email: string };

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const db = (c: { env: Bindings }) => drizzle(c.env.DB, { schema });

// A self-destructing service worker for the retired telemetry.skeptrune.com
// origin. Old visitors have a PWA service worker registered there that serves
// the cached app shell and swallows navigations, so they never see the 301
// below. The browser still fetches /sw.js from the network to check for SW
// updates (that request bypasses the SW), so serving this here lets the old
// worker update to one that unregisters itself, drops its caches, and reloads
// every client — after which navigations hit the network and get redirected.
const KILL_SERVICE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try { await self.registration.unregister(); } catch (e) {}
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) client.navigate(client.url);
  })());
});
`;

// The app moved to skcal.skeptrune.com; permanently redirect the old brand host
// (first middleware so it beats auth + the session guard).
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname === "telemetry.skeptrune.com") {
    // Don't redirect the SW script — serve the kill-switch so stale installs
    // can tear themselves down (a redirected /sw.js just fails the update).
    if (url.pathname === "/sw.js") {
      return new Response(KILL_SERVICE_WORKER, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache, no-store, must-revalidate",
        },
      });
    }
    return c.redirect(`https://skcal.skeptrune.com${url.pathname}${url.search}`, 301);
  }
  return next();
});

const DEV_EMAIL = "dev@local";

// Identity = the Better Auth session's user email. Resolves the session from the
// request cookies/headers; returns null when there is no valid session.
//
// AUTH_DEV_BYPASS (set in local dev + the test env) makes an absent session fall
// back to a dev identity so the app + integration tests run unauthenticated. In
// bypass mode a `cf-access-authenticated-user-email` header, if present, is
// honored as the identity — the integration tests use it to exercise per-user
// data scoping without a real session; otherwise it's `dev@local`. In production
// the flag is unset, so a missing session yields null and the data-route guard
// turns that into a 401.
async function userEmail(c: {
  env: Bindings;
  req: { raw: Request; header: (k: string) => string | undefined };
}): Promise<string | null> {
  try {
    const session = await makeAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    const email = session?.user?.email?.toLowerCase().trim();
    if (email) return email;
  } catch {
    // fall through to the bypass / null path
  }
  if (!c.env.AUTH_DEV_BYPASS) return null;
  return c.req.header("cf-access-authenticated-user-email")?.toLowerCase().trim() || DEV_EMAIL;
}

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
// ---- Better Auth handler ---------------------------------------------------
// Mounted BEFORE the data routes + the guard + the SPA fallback so the auth
// endpoints (sign-in/social, magic-link, callback, get-session, sign-out, …)
// are served directly by Better Auth and never gated by our own session guard.
app.on(["GET", "POST"], "/api/auth/*", (c) => makeAuth(c.env).handler(c.req.raw));

// ---- session guard ---------------------------------------------------------
// Every /api/* data route (i.e. everything except /api/auth/* handled above and
// /api/health) requires a signed-in identity. We resolve it once here, 401 when
// there's no session (and no dev bypass), and stash the email so handlers read
// it synchronously via c.get("email"). The scale-ingest route authenticates
// with its own bearer token, so it's excluded from the session requirement.
app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/health" || path.startsWith("/api/auth/") || path === "/api/ingest/weight") {
    return next();
  }
  const email = await userEmail(c);
  if (!email) return c.json({ error: "unauthorized" }, 401);
  c.set("email", email);
  return next();
});

app.get("/api/health", (c) => c.json({ ok: true, service: "skcal", ts: new Date().toISOString() }));

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
app.get("/api/whoami", (c) => c.json({ email: c.get("email") }));

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
  const email = c.get("email");
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
  const email = c.get("email");
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
  const email = c.get("email");
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
  const email = c.get("email");
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
  const email = c.get("email");
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
  const email = c.get("email");
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
  const email = c.get("email");
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
app.get("/api/targets", async (c) => c.json(await getTargets(c, c.get("email"))));

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
  const email = c.get("email");
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
  const email = c.get("email");
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
 *       description: The meal photos (multipart field `photos`), plus an optional `note` caption for context.
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
 *               note:
 *                 type: string
 *                 maxLength: 2000
 *                 description: Optional caption to disambiguate the photo; passed to the model and stored as the meal note.
 *                 example: the white sauce is toum, and that's a 12oz steak
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
  const email = c.get("email");
  const today = c.req.query("date") ?? new Date().toISOString().slice(0, 10);

  const form = await c.req.formData();
  type UploadFile = { type: string; arrayBuffer: () => Promise<ArrayBuffer> };
  const isFile = (f: unknown): f is UploadFile =>
    typeof f === "object" && f !== null && typeof (f as UploadFile).arrayBuffer === "function";
  const files = (form.getAll("photos") as unknown[]).filter(isFile);
  if (!files.length) return c.json({ error: "no photos uploaded" }, 400);
  if (files.length > 5) return c.json({ error: "max 5 photos per meal" }, 400);
  // Optional caption to disambiguate the photo (e.g. the sauce, the portion).
  const noteRaw = form.get("note");
  const note = typeof noteRaw === "string" ? noteRaw.trim().slice(0, 2000) : "";
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
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text: note
                ? `${VISION_PROMPT}\n\nContext the user gave about this meal (trust it to disambiguate what's shown): ${note}`
                : VISION_PROMPT,
            },
          ],
        },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const out = msg.content.filter((bk) => bk.type === "text").map((bk) => (bk as Anthropic.TextBlock).text).join("");
    parsed = JSON.parse(out);
  } catch (e) {
    return c.json({ error: "analysis failed", detail: String(e) }, 502);
  }

  const mealId = crypto.randomUUID();
  await db(c).insert(schema.meals).values({
    id: mealId, userEmail: email, date: today, note: note || parsed.note || null, photoKeys: JSON.stringify(photoKeys),
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
  const email = c.get("email");
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
  const email = c.get("email");
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
  const email = c.get("email");
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
  const email = c.get("email");
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
  const email = c.get("email");
  const key = decodeURIComponent(c.req.path.replace(/^\/api\/nutrition\/photo\//, ""));
  if (!key.startsWith(`${email}/`)) return c.json({ error: "forbidden" }, 403);
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=86400" },
  });
});

// ---- coach: grounded chat over the caller's targets + today's intake -------
const LB_PER_KG = 2.2046226218;
const kgToLb = (kg: number) => kg * LB_PER_KG;

// Builds the grounded system prompt from the caller's real numbers (same
// sources as the dashboard). Shared by the JSON and streaming coach routes.
async function buildCoachSystem(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  email: string,
  today: string,
): Promise<string> {
  const targets = await getTargets(c, email);
  const nutToday = await db(c)
    .select()
    .from(schema.nutritionDays)
    .where(and(eq(schema.nutritionDays.userEmail, email), eq(schema.nutritionDays.date, today)))
    .limit(1);
  const kcalIn = nutToday[0]?.kcal ?? 0;
  const proteinIn = nutToday[0]?.proteinG ?? 0;

  const weightRows = await db(c)
    .select()
    .from(schema.weightReadings)
    .where(eq(schema.weightReadings.userEmail, email))
    .orderBy(desc(schema.weightReadings.ts), desc(schema.weightReadings.id))
    .limit(120);
  const latestKg = weightRows[0]?.weightKg ?? null;
  const weekCut = Date.now() - 7 * DAY_MS;
  const lastWeek = weightRows.filter((r) => r.ts.getTime() >= weekCut);
  const weeklyAvgKg = lastWeek.length ? lastWeek.reduce((s, r) => s + r.weightKg, 0) / lastWeek.length : null;
  const prevWeekRows = weightRows.filter((r) => {
    const t = r.ts.getTime();
    return t < weekCut && t >= weekCut - 7 * DAY_MS;
  });
  const prevWeekAvgKg = prevWeekRows.length ? prevWeekRows.reduce((s, r) => s + r.weightKg, 0) / prevWeekRows.length : null;

  const kcalTarget = targets.dailyKcalTarget ?? 0;
  const proteinTarget = targets.proteinTargetG ?? 0;
  const kcalLeft = kcalTarget - kcalIn;
  const proteinLeft = proteinTarget - proteinIn;
  const fmtLb = (kg: number | null) => (kg != null ? `${kgToLb(kg).toFixed(1)} lb` : "unknown");
  const trendLine =
    weeklyAvgKg != null && prevWeekAvgKg != null
      ? `week-over-week 7-day average moved ${(kgToLb(weeklyAvgKg) - kgToLb(prevWeekAvgKg)).toFixed(1)} lb (${kgToLb(prevWeekAvgKg).toFixed(1)} → ${kgToLb(weeklyAvgKg).toFixed(1)} lb)`
      : weeklyAvgKg != null
        ? `7-day average is ${fmtLb(weeklyAvgKg)}; not enough history yet for a week-over-week trend`
        : "no recent weigh-ins to compute a trend";

  return [
    "You are the user's blunt, knowledgeable nutrition coach inside their body-recomposition tracker (a lean cut with a protein floor).",
    "Answer using THEIR real numbers below — never invent targets or intake.",
    "",
    "TARGETS:",
    `- Daily calories: ${kcalTarget || "unset"} kcal`,
    `- Daily protein: ${proteinTarget || "unset"} g`,
    `- Goal weight: ${fmtLb(targets.goalWeightKg)}; start weight: ${fmtLb(targets.startWeightKg)}`,
    "",
    "TODAY SO FAR:",
    `- Logged: ${kcalIn} kcal, ${Math.round(proteinIn)} g protein`,
    `- Remaining budget: ${kcalLeft} kcal, ${Math.round(proteinLeft)} g protein${kcalLeft < 0 ? " (already over on calories)" : ""}`,
    "",
    "WEIGHT:",
    `- Latest weigh-in: ${fmtLb(latestKg)}`,
    `- Trend: ${trendLine}`,
    "",
    "When the user asks about eating a specific food: estimate its calories and protein, say how it fits the remaining budget above, then give a short blunt verdict (eat it / fine / skip). If it's a poor fit, suggest a better alternative that protects the protein floor and calorie budget.",
    "Be concise: 2–5 sentences, conversational. Light markdown is fine (a **bold** verdict, an occasional short list) but keep it tight — no headers, no long bullet dumps.",
  ].join("\n");
}

// Validates and normalizes the posted chat history for either coach route.
function parseCoachMessages(
  raw: unknown,
): { messages: { role: "user" | "assistant"; content: string }[] } | { error: string } {
  const arr = Array.isArray(raw) ? (raw as { role?: string; content?: string }[]) : [];
  if (!arr.length) return { error: "messages required" };
  if (arr.length > 20) return { error: "too many messages (max 20)" };
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of arr) {
    if (m.role !== "user" && m.role !== "assistant") return { error: "each message needs role user or assistant" };
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.trim()) return { error: "each message needs content" };
    if (content.length > 2000) return { error: "message content too long (max 2000 chars)" };
    messages.push({ role: m.role, content });
  }
  return { messages };
}

// ---- Coach tools: let the coach view + reorganize the food log ------------
// Resolve a tool-supplied day to YYYY-MM-DD. Accepts an ISO date or the words
// today/yesterday/tomorrow relative to `today` (the request's anchor day).
function resolveToolDate(input: string, today: string): string | null {
  const s = (input || "").trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const shift = s === "today" ? 0 : s === "yesterday" ? -1 : s === "tomorrow" ? 1 : null;
  if (shift == null) return null;
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + shift));
  return dt.toISOString().slice(0, 10);
}

const COACH_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_food_log",
    description:
      "List the user's logged meals and food items for a given day. Call this first to find the meal/item to move.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "Day to list: YYYY-MM-DD, or 'today'/'yesterday'." } },
      required: ["date"],
    },
  },
  {
    name: "move_meal",
    description: "Move an entire logged meal (and all its food items) to a different day.",
    input_schema: {
      type: "object",
      properties: {
        mealId: { type: "string", description: "Meal id from list_food_log." },
        toDate: { type: "string", description: "Destination day: YYYY-MM-DD, or 'today'/'yesterday'." },
      },
      required: ["mealId", "toDate"],
    },
  },
  {
    name: "move_food_item",
    description:
      "Move a single logged food item to a different day. If its meal has other items, the item is split into its own meal on the destination day.",
    input_schema: {
      type: "object",
      properties: {
        itemId: { type: "number", description: "Item id from list_food_log." },
        toDate: { type: "string", description: "Destination day: YYYY-MM-DD, or 'today'/'yesterday'." },
      },
      required: ["itemId", "toDate"],
    },
  },
];

async function executeCoachTool(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  email: string,
  name: string,
  input: Record<string, unknown>,
  today: string,
): Promise<unknown> {
  if (name === "list_food_log") {
    const date = resolveToolDate(String(input.date ?? ""), today) ?? today;
    const mealRows = await db(c)
      .select()
      .from(schema.meals)
      .where(and(eq(schema.meals.userEmail, email), eq(schema.meals.date, date)))
      .orderBy(desc(schema.meals.createdAt));
    const itemRows = await db(c)
      .select()
      .from(schema.nutritionItems)
      .where(and(eq(schema.nutritionItems.userEmail, email), eq(schema.nutritionItems.date, date)));
    return {
      date,
      meals: mealRows.map((m) => ({
        mealId: m.id,
        note: m.note,
        items: itemRows
          .filter((i) => i.mealId === m.id)
          .map((i) => ({ itemId: i.id, name: i.name, kcal: i.kcal, proteinG: i.proteinG })),
      })),
    };
  }

  if (name === "move_meal") {
    const toDate = resolveToolDate(String(input.toDate ?? ""), today);
    if (!toDate) return { error: "invalid toDate" };
    const mealId = String(input.mealId ?? "");
    const meal = (
      await db(c).select().from(schema.meals).where(and(eq(schema.meals.id, mealId), eq(schema.meals.userEmail, email))).limit(1)
    )[0];
    if (!meal) return { error: "meal not found" };
    const fromDate = meal.date;
    await db(c).update(schema.meals).set({ date: toDate }).where(and(eq(schema.meals.id, mealId), eq(schema.meals.userEmail, email)));
    await db(c)
      .update(schema.nutritionItems)
      .set({ date: toDate })
      .where(and(eq(schema.nutritionItems.mealId, mealId), eq(schema.nutritionItems.userEmail, email)));
    await recomputeDay(c, email, fromDate);
    await recomputeDay(c, email, toDate);
    return { ok: true, movedMealId: mealId, fromDate, toDate };
  }

  if (name === "move_food_item") {
    const toDate = resolveToolDate(String(input.toDate ?? ""), today);
    if (!toDate) return { error: "invalid toDate" };
    const itemId = Number(input.itemId);
    const item = (
      await db(c)
        .select()
        .from(schema.nutritionItems)
        .where(and(eq(schema.nutritionItems.id, itemId), eq(schema.nutritionItems.userEmail, email)))
        .limit(1)
    )[0];
    if (!item) return { error: "item not found" };
    const fromDate = item.date;
    const siblings = item.mealId
      ? await db(c)
          .select()
          .from(schema.nutritionItems)
          .where(and(eq(schema.nutritionItems.mealId, item.mealId), eq(schema.nutritionItems.userEmail, email)))
      : [];
    if (item.mealId && siblings.length <= 1) {
      // Sole item in its meal: move the whole meal so grouping stays intact.
      await db(c).update(schema.meals).set({ date: toDate }).where(and(eq(schema.meals.id, item.mealId), eq(schema.meals.userEmail, email)));
      await db(c).update(schema.nutritionItems).set({ date: toDate }).where(eq(schema.nutritionItems.id, itemId));
    } else {
      // Split the item into its own meal on the destination day.
      const newMealId = crypto.randomUUID();
      await db(c).insert(schema.meals).values({ id: newMealId, userEmail: email, date: toDate, note: item.name });
      await db(c).update(schema.nutritionItems).set({ date: toDate, mealId: newMealId }).where(eq(schema.nutritionItems.id, itemId));
    }
    await recomputeDay(c, email, fromDate);
    await recomputeDay(c, email, toDate);
    return { ok: true, movedItemId: itemId, name: item.name, fromDate, toDate };
  }

  return { error: "unknown tool" };
}

/**
 * @openapi
 * /api/agent:
 *   post:
 *     tags: [Coach]
 *     summary: Ask the AI coach
 *     description: >-
 *       Sends a short chat history to Claude with a system prompt grounded in the caller's own
 *       targets, today's logged calories and protein, and their latest weight and weekly trend.
 *       Use it before eating to get a blunt verdict on a food and how it fits the remaining budget.
 *       The client holds the conversation history and posts the whole thing each turn.
 *     operationId: coach
 *     parameters:
 *       - name: date
 *         in: query
 *         required: false
 *         description: Day to ground today's intake against (YYYY-MM-DD). Defaults to the server's current UTC date.
 *         schema:
 *           type: string
 *           format: date
 *     requestBody:
 *       required: true
 *       description: The chat history to answer, oldest message first.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CoachRequest'
 *     responses:
 *       '200':
 *         description: The coach's reply.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CoachReply'
 *       '400':
 *         $ref: '#/components/responses/BadRequest'
 *       '502':
 *         $ref: '#/components/responses/BadGateway'
 *       '503':
 *         $ref: '#/components/responses/ServiceUnavailable'
 */
app.post("/api/agent", async (c) => {
  const email = c.get("email");
  const b = await c.req.json<{ messages?: unknown; date?: string }>();
  const parsed = parseCoachMessages(b.messages);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const messages = parsed.messages;
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "coach not configured" }, 503);

  const today = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const system = await buildCoachSystem(c, email, today);

  const anthropic = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  let reply: string;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 600,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    } as Anthropic.MessageCreateParamsNonStreaming);
    reply = msg.content
      .filter((bk) => bk.type === "text")
      .map((bk) => (bk as Anthropic.TextBlock).text)
      .join("")
      .trim();
  } catch (e) {
    return c.json({ error: "coach failed", detail: String(e) }, 502);
  }

  return c.json({ reply });
});

// Streaming sibling of /api/agent for the in-app chat UI (assistant-ui). Emits
// the reply as a plain-text token stream so the coach types out live. The JSON
// route above stays for the CLI/API/MCP surface.
app.post("/api/agent/stream", async (c) => {
  const email = c.get("email");
  const b = await c.req.json<{ messages?: unknown; date?: string }>();
  const parsed = parseCoachMessages(b.messages);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const messages = parsed.messages;
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "coach not configured" }, 503);

  const today = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const system =
    (await buildCoachSystem(c, email, today)) +
    `\n\nTools: you can view and reorganize the food log with list_food_log, move_meal, and move_food_item. Today's date is ${today}. To move / re-date / fix which day food was logged on, first call list_food_log for the relevant day to find the exact meal or item, then move it. IMPORTANT: while calling tools, do NOT write any prose — just make the tool calls. Only AFTER every change is done, write exactly ONE short sentence confirming what changed (item + from day → to day). Never repeat that confirmation.`;

  const anthropic = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();
  // NDJSON event protocol so the client renders tool calls as real parts rather
  // than mashing each turn's text together: {t:"text",v} / {t:"tool"} / {t:"result"}.
  const convo: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        // Agentic loop: stream each turn's text; if the model calls tools,
        // emit tool + result events, then continue until it stops.
        for (let turn = 0; turn < 6; turn++) {
          const msgStream = anthropic.messages.stream({
            model: "claude-opus-4-8",
            max_tokens: 700,
            system,
            messages: convo,
            tools: COACH_TOOLS,
          });
          for await (const event of msgStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send({ t: "text", v: event.delta.text });
            }
          }
          const final = await msgStream.finalMessage();
          const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (toolUses.length === 0) break;
          convo.push({ role: "assistant", content: final.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            send({ t: "tool", id: tu.id, name: tu.name, args: tu.input });
            const out = await executeCoachTool(c, email, tu.name, tu.input as Record<string, unknown>, today);
            send({ t: "result", id: tu.id, result: out });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
          }
          convo.push({ role: "user", content: results });
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

// A short thread title from the first user message (ChatGPT-style).
function deriveConversationTitle(messages: { role: string; content: string }[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "";
  const t = first.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

// ---- Coach conversation history (saved threads + local-search source) ------
// List the caller's conversations, newest first, each with its full message
// list so the client can render history and search it locally.
app.get("/api/agent/conversations", async (c) => {
  const email = c.get("email");
  const convs = await db(c)
    .select()
    .from(schema.coachConversations)
    .where(eq(schema.coachConversations.userEmail, email))
    .orderBy(desc(schema.coachConversations.updatedAt));
  const ids = convs.map((x) => x.id);
  const rows = ids.length
    ? await db(c)
        .select()
        .from(schema.coachMessages)
        .where(inArray(schema.coachMessages.conversationId, ids))
        .orderBy(asc(schema.coachMessages.id))
    : [];
  const byConv = new Map<string, { role: string; content: string }[]>();
  for (const m of rows) {
    const arr = byConv.get(m.conversationId) ?? [];
    arr.push({ role: m.role, content: m.content });
    byConv.set(m.conversationId, arr);
  }
  return c.json(
    convs.map((x) => ({
      id: x.id,
      title: x.title,
      createdAt: x.createdAt.getTime(),
      updatedAt: x.updatedAt.getTime(),
      messages: byConv.get(x.id) ?? [],
    })),
  );
});

// Create a conversation seeded with its first turn.
app.post("/api/agent/conversations", async (c) => {
  const email = c.get("email");
  const b = await c.req.json<{ title?: string; messages?: unknown }>();
  const parsed = parseCoachMessages(b.messages);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const id = crypto.randomUUID();
  const title = (typeof b.title === "string" && b.title.trim() ? b.title.trim() : deriveConversationTitle(parsed.messages)).slice(0, 120);
  await db(c).insert(schema.coachConversations).values({ id, userEmail: email, title });
  await db(c)
    .insert(schema.coachMessages)
    .values(parsed.messages.map((m) => ({ conversationId: id, role: m.role, content: m.content })));
  return c.json({ id, title });
});

// Append a turn (user + assistant) to an existing conversation.
app.post("/api/agent/conversations/:id/messages", async (c) => {
  const email = c.get("email");
  const id = c.req.param("id");
  const b = await c.req.json<{ messages?: unknown }>();
  const parsed = parseCoachMessages(b.messages);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const owned = await db(c)
    .select({ id: schema.coachConversations.id })
    .from(schema.coachConversations)
    .where(and(eq(schema.coachConversations.id, id), eq(schema.coachConversations.userEmail, email)))
    .limit(1);
  if (!owned.length) return c.json({ error: "not found" }, 404);
  await db(c)
    .insert(schema.coachMessages)
    .values(parsed.messages.map((m) => ({ conversationId: id, role: m.role, content: m.content })));
  await db(c).update(schema.coachConversations).set({ updatedAt: new Date() }).where(eq(schema.coachConversations.id, id));
  return c.json({ ok: true });
});

// Delete a conversation and its messages.
app.delete("/api/agent/conversations/:id", async (c) => {
  const email = c.get("email");
  const id = c.req.param("id");
  const owned = await db(c)
    .select({ id: schema.coachConversations.id })
    .from(schema.coachConversations)
    .where(and(eq(schema.coachConversations.id, id), eq(schema.coachConversations.userEmail, email)))
    .limit(1);
  if (!owned.length) return c.json({ error: "not found" }, 404);
  await db(c).delete(schema.coachMessages).where(eq(schema.coachMessages.conversationId, id));
  await db(c).delete(schema.coachConversations).where(eq(schema.coachConversations.id, id));
  return c.json({ ok: true });
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
 *               example: { openapi: "3.1.0", info: { title: skcal, version: "1.0.0" }, paths: {} }
 */
app.get("/openapi.json", (c) =>
  c.json(openapiDoc as Record<string, unknown>, 200, { "cache-control": "public, max-age=300" }),
);

// (The Cloudflare Access `/cli-auth` bounce was removed with the Access swap to
// Better Auth. The CLI login rebuild lands in a later pass; the CLI package is
// left untouched for now.)

// ---- Profile avatar --------------------------------------------------------
// Upload a custom profile picture (stored in R2) and point the user's Better
// Auth `image` at it. Used when there's no Google/Gravatar picture.
app.post("/api/profile/avatar", async (c) => {
  const email = c.get("email");
  const form = await c.req.formData();
  const file = form.get("photo") as unknown as { type?: string; stream?: () => ReadableStream } | null;
  if (!file || typeof file.stream !== "function" || !file.type?.startsWith("image/"))
    return c.json({ error: "image file required" }, 400);
  const id = crypto.randomUUID();
  await c.env.PHOTOS.put(`avatars/${id}`, file.stream(), { httpMetadata: { contentType: file.type } });
  const image = `/api/profile/avatar/${id}`;
  await db(c).update(schema.user).set({ image, updatedAt: new Date() }).where(eq(schema.user.email, email));
  return c.json({ image });
});

app.get("/api/profile/avatar/:id", async (c) => {
  const obj = await c.env.PHOTOS.get(`avatars/${c.req.param("id")}`);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": "private, max-age=86400",
    },
  });
});

// ---- Legal pages (public) --------------------------------------------------
// Stable, unauthenticated URLs required by the Claude + ChatGPT connector
// directories (a missing privacy policy is an automatic rejection).
function legalPage(title: string, bodyHtml: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} · skcal</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#17181a;color:#ececec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6}
main{max-width:720px;margin:0 auto;padding:3rem 1.25rem 5rem}
a{color:#f59e0b}
h1{font-size:1.7rem;margin:0 0 .3rem}
h2{font-size:1.1rem;margin:2rem 0 .4rem}
p,li{color:#c9cbcf}
.muted{color:#9a9ca0;font-size:.85rem}
code{font-family:ui-monospace,monospace;background:#1f2123;padding:.05rem .3rem;border-radius:5px}
</style></head><body><main>
<p class="muted"><a href="/">skcal</a></p>
<h1>${title}</h1>
${bodyHtml}
<p class="muted" style="margin-top:2.5rem">Questions: <a href="mailto:me@skeptrune.com">me@skeptrune.com</a></p>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

app.get("/privacy", () =>
  legalPage(
    "Privacy Policy",
    `<p class="muted">Last updated: 2026-07-02</p>
<p>skcal ("we") is a personal calorie and body-composition tracker. This policy explains what we collect and how it's used.</p>
<h2>What we collect</h2>
<ul>
<li><strong>Account</strong>: your email, and a name/profile image if provided by Google sign-in or Gravatar.</li>
<li><strong>Your data</strong>: weigh-ins, body-fat %, measurements, nutrition entries, meal photos, targets, and messages you send to the in-app agent.</li>
</ul>
<h2>How we use it</h2>
<ul>
<li>To provide the tracking features and show your dashboard.</li>
<li>Meal photos/descriptions and agent messages are sent to <strong>Anthropic</strong> (Claude) to estimate macros and answer questions. We do not use your data to train models.</li>
<li>Access via the API/MCP server happens only with an OAuth token you explicitly authorize; revoke it any time by removing the connector.</li>
</ul>
<h2>Storage &amp; processors</h2>
<p>Your data is stored on <strong>Cloudflare</strong> (D1 and R2). We share data only with the processors needed to run skcal: Cloudflare (hosting/storage), Anthropic (AI features), Google (optional sign-in), and Fastmail (magic-link emails). We do not sell your data.</p>
<h2>Retention &amp; deletion</h2>
<p>Data is kept until you delete it. Email <a href="mailto:me@skeptrune.com">me@skeptrune.com</a> to export or delete your account and data.</p>
<h2>Contact</h2>
<p>Questions or requests: <a href="mailto:me@skeptrune.com">me@skeptrune.com</a>.</p>`,
  ),
);

app.get("/terms", () =>
  legalPage(
    "Terms of Service",
    `<p class="muted">Last updated: 2026-07-02</p>
<p>By using skcal you agree to these terms.</p>
<h2>Use of the service</h2>
<p>skcal is provided for personal health and fitness tracking. You're responsible for the accuracy of what you log and for keeping your account secure.</p>
<h2>Not medical advice</h2>
<p>skcal and its AI agent provide estimates and general guidance only. They are not medical, nutritional, or professional advice. Consult a qualified professional for health decisions.</p>
<h2>AI features</h2>
<p>Macro estimates and agent responses are generated by AI and may be inaccurate. Verify anything important.</p>
<h2>Availability &amp; warranty</h2>
<p>The service is provided "as is", without warranty of any kind, and may change or be unavailable at any time. To the extent permitted by law, we are not liable for any damages arising from use of the service.</p>
<h2>Contact</h2>
<p>Questions: <a href="mailto:me@skeptrune.com">me@skeptrune.com</a>.</p>`,
  ),
);

// ---- MCP server (Streamable HTTP, OAuth 2.1 via Better Auth) ---------------
// Builds a per-request MCP server bound to the authenticated user's email.
// Tools mirror the app's core operations so MCP clients can log + query data.
function buildMcpServer(c: Context<{ Bindings: Bindings; Variables: Variables }>, email: string): McpServer {
  const server = new McpServer({ name: "skcal-mcp-server", version: "1.0.0" });
  const todayUTC = () => new Date().toISOString().slice(0, 10);
  const ok = (data: unknown, text?: string) => ({
    content: [{ type: "text" as const, text: text ?? JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  });

  server.registerTool(
    "skcal_get_status",
    {
      title: "Daily status",
      description:
        "Get the user's nutrition status for a day (calories + protein logged vs. targets and remaining budget) plus their latest weight. Defaults to today.",
      inputSchema: { date: z.string().optional().describe("Day as YYYY-MM-DD, or 'today'/'yesterday'. Default today.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date }) => {
      const day = resolveToolDate(date ?? "today", todayUTC()) ?? todayUTC();
      const targets = await getTargets(c, email);
      const nut = (
        await db(c)
          .select()
          .from(schema.nutritionDays)
          .where(and(eq(schema.nutritionDays.userEmail, email), eq(schema.nutritionDays.date, day)))
          .limit(1)
      )[0];
      const latest = (
        await db(c)
          .select()
          .from(schema.weightReadings)
          .where(eq(schema.weightReadings.userEmail, email))
          .orderBy(desc(schema.weightReadings.ts))
          .limit(1)
      )[0];
      const kcalIn = nut?.kcal ?? 0;
      const proteinIn = nut?.proteinG ?? 0;
      return ok({
        date: day,
        calories: { logged: kcalIn, target: targets.dailyKcalTarget, remaining: (targets.dailyKcalTarget ?? 0) - kcalIn },
        protein: { loggedG: proteinIn, targetG: targets.proteinTargetG, remainingG: (targets.proteinTargetG ?? 0) - proteinIn },
        latestWeightLb: latest ? Number(kgToLb(latest.weightKg).toFixed(1)) : null,
      });
    },
  );

  server.registerTool(
    "skcal_get_targets",
    {
      title: "Get targets",
      description: "Get the user's daily calorie + protein targets and goal/start weight.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const t = await getTargets(c, email);
      return ok({
        dailyKcalTarget: t.dailyKcalTarget,
        proteinTargetG: t.proteinTargetG,
        goalWeightLb: t.goalWeightKg != null ? Number(kgToLb(t.goalWeightKg).toFixed(1)) : null,
        startWeightLb: t.startWeightKg != null ? Number(kgToLb(t.startWeightKg).toFixed(1)) : null,
      });
    },
  );

  server.registerTool(
    "skcal_list_weigh_ins",
    {
      title: "List weigh-ins",
      description: "List the user's most recent weigh-ins (pounds), newest first.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 20).") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      const n = limit ?? 20;
      const rows = await db(c)
        .select()
        .from(schema.weightReadings)
        .where(eq(schema.weightReadings.userEmail, email))
        .orderBy(desc(schema.weightReadings.ts))
        .limit(n);
      return ok({
        count: rows.length,
        weighIns: rows.map((r) => ({
          id: r.id,
          date: new Date(r.ts).toISOString().slice(0, 10),
          pounds: Number(kgToLb(r.weightKg).toFixed(1)),
          bodyFatPct: r.bodyFatPct,
          note: r.note,
          source: r.source,
        })),
      });
    },
  );

  server.registerTool(
    "skcal_log_weight",
    {
      title: "Log weight",
      description: "Record a body-weight reading in pounds. Optionally include body-fat % and a note.",
      inputSchema: {
        pounds: z.number().min(30).max(700).describe("Body weight in pounds."),
        bodyFatPct: z.number().min(1).max(80).optional().describe("Body-fat %, if known."),
        note: z.string().max(500).optional().describe("Optional note, e.g. 'morning, fasted'."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ pounds, bodyFatPct, note }) => {
      await db(c)
        .insert(schema.weightReadings)
        .values({ userEmail: email, weightKg: lbToKg(pounds), bodyFatPct: bodyFatPct ?? null, note: note?.trim() || null, source: "manual" });
      return ok({ ok: true, loggedPounds: pounds }, `Logged ${pounds} lb.`);
    },
  );

  server.registerTool(
    "skcal_log_measurement",
    {
      title: "Log measurement",
      description: "Record a body-part circumference measurement in inches.",
      inputSchema: {
        site: z.enum(MEASUREMENT_SITES as unknown as [string, ...string[]]).describe("Body site."),
        inches: z.number().min(1).max(120).describe("Circumference in inches."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ site, inches }) => {
      await db(c).insert(schema.measurements).values({ userEmail: email, site, valueCm: inToCm(inches), source: "manual" });
      return ok({ ok: true, site, inches }, `Logged ${site} = ${inches} in.`);
    },
  );

  server.registerTool(
    "skcal_log_meal",
    {
      title: "Log a meal",
      description:
        "Log a food item with its calorie + protein estimate for a day (default today). Estimate the macros yourself if the user gives a plain description.",
      inputSchema: {
        name: z.string().min(1).max(200).describe("Food description, e.g. '1 oz beef jerky'."),
        kcal: z.number().int().min(0).max(10000).describe("Calories."),
        proteinG: z.number().min(0).max(500).describe("Protein in grams."),
        date: z.string().optional().describe("Day as YYYY-MM-DD, or 'today'/'yesterday'. Default today."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, kcal, proteinG, date }) => {
      const day = resolveToolDate(date ?? "today", todayUTC()) ?? todayUTC();
      const mealId = crypto.randomUUID();
      await db(c).insert(schema.meals).values({ id: mealId, userEmail: email, date: day, note: name });
      await db(c)
        .insert(schema.nutritionItems)
        .values({ userEmail: email, mealId, date: day, name, kcal, proteinG, source: "manual" });
      await recomputeDay(c, email, day);
      return ok({ ok: true, mealId, date: day, name, kcal, proteinG }, `Logged ${name} (${kcal} kcal / ${proteinG} g protein) on ${day}.`);
    },
  );

  server.registerTool(
    "skcal_list_meals",
    {
      title: "List meals",
      description: "List the meals and food items logged on a day (default today).",
      inputSchema: { date: z.string().optional().describe("Day as YYYY-MM-DD, or 'today'/'yesterday'. Default today.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ date }) => {
      const day = resolveToolDate(date ?? "today", todayUTC()) ?? todayUTC();
      const result = await executeCoachTool(c, email, "list_food_log", { date: day }, todayUTC());
      return ok(result);
    },
  );

  server.registerTool(
    "skcal_move_food",
    {
      title: "Move food between days",
      description:
        "Move a logged meal (by mealId) or a single food item (by itemId) to a different day. Provide exactly one of mealId or itemId. Use skcal_list_meals first to find the id.",
      inputSchema: {
        mealId: z.string().optional().describe("Meal id to move (moves all its items)."),
        itemId: z.number().int().optional().describe("Single item id to move."),
        toDate: z.string().describe("Destination day as YYYY-MM-DD, or 'today'/'yesterday'."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ mealId, itemId, toDate }) => {
      if (mealId) return ok(await executeCoachTool(c, email, "move_meal", { mealId, toDate }, todayUTC()));
      if (itemId != null) return ok(await executeCoachTool(c, email, "move_food_item", { itemId, toDate }, todayUTC()));
      return { isError: true, content: [{ type: "text" as const, text: "Provide either mealId or itemId." }] };
    },
  );

  return server;
}

// OAuth 2.1 discovery so MCP clients can find the authorization + resource
// metadata for the skcal server (served by Better Auth's mcp plugin).
app.get("/.well-known/oauth-authorization-server", (c) =>
  oAuthDiscoveryMetadata(makeAuth(c.env) as unknown as Parameters<typeof oAuthDiscoveryMetadata>[0])(c.req.raw),
);
app.get("/.well-known/oauth-protected-resource", (c) =>
  oAuthProtectedResourceMetadata(makeAuth(c.env) as unknown as Parameters<typeof oAuthProtectedResourceMetadata>[0])(c.req.raw),
);

// The MCP endpoint itself. Requires a valid OAuth access token (resolved by the
// Better Auth mcp plugin); unauthenticated calls get a 401 pointing clients at
// the protected-resource metadata so they can start the OAuth flow.
app.all("/mcp", async (c) => {
  const auth = makeAuth(c.env);
  const mcpApi = auth.api as unknown as {
    getMcpSession: (args: { headers: Headers }) => Promise<{ userId: string } | null>;
  };
  const session = await mcpApi.getMcpSession({ headers: c.req.raw.headers });
  if (!session) {
    const resource = `${new URL(c.req.url).origin}/.well-known/oauth-protected-resource`;
    return c.json({ error: "unauthorized" }, 401, {
      "WWW-Authenticate": `Bearer resource_metadata="${resource}"`,
    });
  }
  const userRow = (
    await db(c).select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, session.userId)).limit(1)
  )[0];
  if (!userRow) return c.json({ error: "unknown user" }, 401);

  const server = buildMcpServer(c, userRow.email);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

// ---- SPA fallback ----------------------------------------------------------
// Cache policy that makes redeploys take effect without a hard refresh:
//   - the service worker + the HTML shell are always revalidated (no-cache), so
//     the browser/edge never serve a stale `sw.js` or stale index.html that
//     points at old JS bundles — a new deploy is picked up on the next request;
//   - content-hashed build assets (/assets/*.[hash].js|css) are immutable, so
//     the fresh HTML pulls the new hashed files and the old ones just fall away.
app.all("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const path = new URL(c.req.url).pathname;
  const contentType = res.headers.get("content-type") ?? "";
  const isServiceWorker = path === "/sw.js" || path.endsWith("/sw.js");
  const isHtml = contentType.includes("text/html");
  const isHashedAsset = path.startsWith("/assets/");

  let cacheControl: string | null = null;
  if (isServiceWorker) {
    cacheControl = "no-cache, no-store, must-revalidate";
  } else if (isHtml) {
    cacheControl = "no-cache";
  } else if (isHashedAsset) {
    cacheControl = "public, max-age=31536000, immutable";
  }
  if (!cacheControl) return res;

  const next = new Response(res.body, res);
  next.headers.set("cache-control", cacheControl);
  return next;
});

export default app;
