import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { DashboardData, Targets } from "../shared/types";

type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  INGEST_TOKEN?: string;
};

const app = new Hono<{ Bindings: Bindings }>();
const db = (c: { env: Bindings }) => drizzle(c.env.DB, { schema });

const DAY_MS = 86_400_000;
const DEFAULT_TARGETS = {
  goalWeightKg: 66.7, // ~147 lb
  startWeightKg: 72.6, // ~160 lb
  dailyKcalTarget: 1850,
  proteinTargetG: 160,
};

// ---- health ----------------------------------------------------------------
app.get("/api/health", (c) =>
  c.json({ ok: true, service: "telemetry", ts: new Date().toISOString() }),
);

// ---- weight ----------------------------------------------------------------
app.get("/api/weight", async (c) => {
  const rows = await db(c)
    .select()
    .from(schema.weightReadings)
    .orderBy(desc(schema.weightReadings.ts), desc(schema.weightReadings.id))
    .limit(365);
  return c.json(
    rows.map((r) => ({
      id: r.id,
      ts: r.ts.getTime(),
      weightKg: r.weightKg,
      bodyFatPct: r.bodyFatPct,
      source: r.source,
    })),
  );
});

app.post("/api/weight", async (c) => {
  const body = await c.req.json<{ weightKg?: number; bodyFatPct?: number | null }>();
  if (typeof body.weightKg !== "number" || !isFinite(body.weightKg) || body.weightKg < 9 || body.weightKg > 320) {
    return c.json({ error: "weightKg must be 9–320 kg" }, 400);
  }
  if (body.bodyFatPct != null && (body.bodyFatPct < 1 || body.bodyFatPct > 80)) {
    return c.json({ error: "bodyFatPct must be 1–80" }, 400);
  }
  await db(c).insert(schema.weightReadings).values({
    weightKg: body.weightKg,
    bodyFatPct: body.bodyFatPct ?? null,
    source: "manual",
  });
  return c.json({ ok: true });
});

// ---- measurements ----------------------------------------------------------
app.get("/api/measurements", async (c) => {
  const rows = await db(c)
    .select()
    .from(schema.measurements)
    .orderBy(desc(schema.measurements.ts), desc(schema.measurements.id))
    .limit(500);
  return c.json(
    rows.map((r) => ({
      id: r.id,
      ts: r.ts.getTime(),
      site: r.site,
      valueCm: r.valueCm,
      source: r.source,
    })),
  );
});

app.post("/api/measurements", async (c) => {
  const body = await c.req.json<{ site?: string; valueCm?: number }>();
  if (
    !body.site ||
    typeof body.valueCm !== "number" ||
    !isFinite(body.valueCm) ||
    body.valueCm < 1 ||
    body.valueCm > 300
  ) {
    return c.json({ error: "site + valueCm (1–300 cm) required" }, 400);
  }
  await db(c).insert(schema.measurements).values({
    site: body.site,
    valueCm: body.valueCm,
    source: "manual",
  });
  return c.json({ ok: true });
});

// ---- nutrition (per-day upsert) --------------------------------------------
app.get("/api/nutrition", async (c) => {
  const rows = await db(c)
    .select()
    .from(schema.nutritionDays)
    .orderBy(desc(schema.nutritionDays.date))
    .limit(60);
  return c.json(rows);
});

app.put("/api/nutrition", async (c) => {
  const b = await c.req.json<{
    date?: string;
    kcal?: number | null;
    proteinG?: number | null;
    hitProtein?: boolean | null;
    adherence?: "under" | "on" | "over" | null;
  }>();
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    return c.json({ error: "date (YYYY-MM-DD) required" }, 400);
  }
  if (b.kcal != null && (b.kcal < 0 || b.kcal > 20000)) {
    return c.json({ error: "kcal must be 0–20000" }, 400);
  }
  if (b.proteinG != null && (b.proteinG < 0 || b.proteinG > 1000)) {
    return c.json({ error: "proteinG must be 0–1000" }, 400);
  }
  const values = {
    date: b.date,
    kcal: b.kcal ?? null,
    proteinG: b.proteinG ?? null,
    hitProtein: b.hitProtein ?? null,
    adherence: b.adherence ?? null,
  };
  await db(c)
    .insert(schema.nutritionDays)
    .values(values)
    .onConflictDoUpdate({ target: schema.nutritionDays.date, set: values });
  return c.json({ ok: true });
});

// ---- targets (single row) --------------------------------------------------
async function getTargets(c: { env: Bindings }): Promise<Targets & { id: number }> {
  const existing = await db(c).select().from(schema.targets).limit(1);
  if (existing.length) {
    const t = existing[0];
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
  const inserted = await db(c)
    .insert(schema.targets)
    .values({ ...DEFAULT_TARGETS, startDate: new Date() })
    .returning();
  const t = inserted[0];
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

app.get("/api/targets", async (c) => c.json(await getTargets(c)));

app.put("/api/targets", async (c) => {
  const b = await c.req.json<Partial<Targets>>();
  const current = await getTargets(c);
  await db(c)
    .update(schema.targets)
    .set({
      goalWeightKg: b.goalWeightKg ?? current.goalWeightKg,
      startWeightKg: b.startWeightKg ?? current.startWeightKg,
      dailyKcalTarget: b.dailyKcalTarget ?? current.dailyKcalTarget,
      proteinTargetG: b.proteinTargetG ?? current.proteinTargetG,
      targetDate: b.targetDate ? new Date(b.targetDate) : undefined,
    })
    .where(eq(schema.targets.id, current.id));
  return c.json({ ok: true });
});

// ---- dashboard aggregate ---------------------------------------------------
app.get("/api/dashboard", async (c) => {
  const today = c.req.query("date") ?? new Date().toISOString().slice(0, 10);

  const weightRows = await db(c)
    .select()
    .from(schema.weightReadings)
    .orderBy(desc(schema.weightReadings.ts), desc(schema.weightReadings.id))
    .limit(120);

  const trend = weightRows
    .map((r) => ({ ts: r.ts.getTime(), kg: r.weightKg }))
    .reverse();
  const latest = weightRows[0] ?? null;
  const weekCut = Date.now() - 7 * DAY_MS;
  const lastWeek = weightRows.filter((r) => r.ts.getTime() >= weekCut);
  const weeklyAvgKg = lastWeek.length
    ? lastWeek.reduce((s, r) => s + r.weightKg, 0) / lastWeek.length
    : null;

  // latest measurement per site
  const mRows = await db(c)
    .select()
    .from(schema.measurements)
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
    .where(eq(schema.nutritionDays.date, today))
    .limit(1);

  const targets = await getTargets(c);

  const data: DashboardData = {
    weight: {
      latestKg: latest?.weightKg ?? null,
      weeklyAvgKg,
      bodyFatPct: latest?.bodyFatPct ?? null,
      trend,
    },
    targets,
    measurementsLatest,
    shoulderToWaist,
    nutritionToday: nutToday[0] ?? null,
  };
  return c.json(data);
});

// ---- scale ingest (token-auth; CF Access exempts this path) ----------------
app.post("/api/ingest/weight", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!c.env.INGEST_TOKEN) return c.json({ error: "ingest not configured" }, 503);
  if (token !== c.env.INGEST_TOKEN) return c.json({ error: "unauthorized" }, 401);
  const b = await c.req.json<{ weightKg?: number; bodyFatPct?: number | null; raw?: unknown }>();
  if (typeof b.weightKg !== "number" || !isFinite(b.weightKg) || b.weightKg < 9 || b.weightKg > 320) {
    return c.json({ error: "weightKg out of range" }, 400);
  }
  await db(c).insert(schema.weightReadings).values({
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
