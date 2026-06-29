import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { DashboardData, Targets } from "../shared/types";

type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  INGEST_TOKEN?: string;
  INGEST_USER_EMAIL?: string;
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

app.get("/api/health", (c) => c.json({ ok: true, service: "telemetry", ts: new Date().toISOString() }));

app.get("/api/whoami", (c) => c.json({ email: userEmail(c) }));

// ---- weight ----------------------------------------------------------------
app.get("/api/weight", async (c) => {
  const email = userEmail(c);
  const rows = await db(c)
    .select()
    .from(schema.weightReadings)
    .where(eq(schema.weightReadings.userEmail, email))
    .orderBy(desc(schema.weightReadings.ts), desc(schema.weightReadings.id))
    .limit(365);
  return c.json(rows.map((r) => ({ id: r.id, ts: r.ts.getTime(), weightKg: r.weightKg, bodyFatPct: r.bodyFatPct, source: r.source })));
});

app.post("/api/weight", async (c) => {
  const email = userEmail(c);
  const body = await c.req.json<{ weightKg?: number; bodyFatPct?: number | null }>();
  if (typeof body.weightKg !== "number" || !isFinite(body.weightKg) || body.weightKg < 9 || body.weightKg > 320) {
    return c.json({ error: "weightKg must be 9–320 kg" }, 400);
  }
  if (body.bodyFatPct != null && (body.bodyFatPct < 1 || body.bodyFatPct > 80)) {
    return c.json({ error: "bodyFatPct must be 1–80" }, 400);
  }
  await db(c).insert(schema.weightReadings).values({ userEmail: email, weightKg: body.weightKg, bodyFatPct: body.bodyFatPct ?? null, source: "manual" });
  return c.json({ ok: true });
});

// ---- measurements ----------------------------------------------------------
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

app.get("/api/targets", async (c) => c.json(await getTargets(c, userEmail(c))));

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
    weight: { latestKg: latest?.weightKg ?? null, weeklyAvgKg, bodyFatPct: latest?.bodyFatPct ?? null, trend },
    targets,
    measurementsLatest,
    shoulderToWaist,
    nutritionToday: nutToday[0] ?? null,
  };
  return c.json(data);
});

// ---- scale ingest (token-auth; attributed to a configured user) ------------
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

// ---- SPA fallback ----------------------------------------------------------
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
