import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import * as schema from "../db/schema";
import type { DashboardData, Targets } from "../shared/types";

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

const VISION_PROMPT_BEFORE_AFTER =
  "These images are a BEFORE/AFTER set for ONE serving: the first image is the food before eating; the remaining image(s) show the leftovers afterward. Estimate ONLY what was actually consumed — the before portion minus what remains. If there is just one image, treat it as fully eaten. List each consumed food with its kcal and protein (grams), sum into total_kcal and total_protein_g, and in `note` say it's a before/after estimate of what was eaten.";

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
  return c.json(rows.map((r) => ({ id: r.id, ts: r.ts.getTime(), weightKg: r.weightKg, bodyFatPct: r.bodyFatPct, note: r.note, source: r.source })));
});

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
    weight: { latestKg: latest?.weightKg ?? null, weeklyAvgKg, bodyFatPct: latest?.bodyFatPct ?? null, note: latest?.note ?? null, trend },
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

// ---- nutrition: photo -> Claude vision -> macros ---------------------------
app.post("/api/nutrition/analyze", async (c) => {
  const email = userEmail(c);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: "vision not configured" }, 503);
  const today = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const prompt = c.req.query("mode") === "beforeafter" ? VISION_PROMPT_BEFORE_AFTER : VISION_PROMPT;

  const form = await c.req.formData();
  type UploadFile = { type: string; arrayBuffer: () => Promise<ArrayBuffer> };
  const isFile = (f: unknown): f is UploadFile =>
    typeof f === "object" && f !== null && typeof (f as UploadFile).arrayBuffer === "function";
  const files = (form.getAll("photos") as unknown[]).filter(isFile);
  if (!files.length) return c.json({ error: "no photos uploaded" }, 400);
  if (files.length > 5) return c.json({ error: "max 5 photos per meal" }, 400);

  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  const photoKeys: string[] = [];
  for (const file of files) {
    const mt = file.type || "image/jpeg";
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mt)) return c.json({ error: `unsupported image type ${mt}` }, 400);
    const buf = await file.arrayBuffer();
    if (buf.byteLength > 8_000_000) return c.json({ error: "image too large (max 8MB)" }, 400);
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
      messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: prompt }] }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
    parsed = JSON.parse(text);
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

// ---- SPA fallback ----------------------------------------------------------
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
