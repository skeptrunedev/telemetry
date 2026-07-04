import { describe, expect, it } from "vitest";
import { workerFetch, workerFetchNoBypass } from "./harness";

// End-to-end Worker API tests. We drive the REAL Worker in-process (esbuild
// bundle running inside Miniflare with real D1/R2 — see test/harness.ts), so
// routing, Hono handlers, D1 and R2 all run exactly as in production. Identity
// is supplied via the cf-access-authenticated-user-email header (the same
// header Cloudflare Access injects); absent it, the Worker falls back to
// dev@local. The AI/ingest secrets are bound empty, so the AI routes take their
// guard-rail paths and never call the model.

/** Dispatch to the Worker with the Access identity header set. */
function asUser(email: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", email);
  return workerFetch(path, { ...init, headers });
}

function jsonPost(email: string, path: string, body: unknown, method = "POST") {
  return asUser(email, path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("service", () => {
  it("GET /api/health → 200 ok payload", async () => {
    const res = await workerFetch(`/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string; ts: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("skcal");
    expect(typeof body.ts).toBe("string");
  });

  it("GET /api/whoami → dev@local with no identity header", async () => {
    const res = await workerFetch(`/api/whoami`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "dev@local" });
  });

  it("GET /api/whoami → reflects the access email header", async () => {
    const res = await asUser("Whoami@Example.com", "/api/whoami");
    expect(res.status).toBe(200);
    // The Worker lowercases + trims the identity.
    expect(await res.json()).toEqual({ email: "whoami@example.com" });
  });
});

describe("weight", () => {
  const user = "weight-user@example.com";

  it("POST valid → ok, then GET includes it", async () => {
    const post = await jsonPost(user, "/api/weight", { weightKg: 72.6, note: "morning" });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ ok: true });

    const get = await asUser(user, "/api/weight");
    expect(get.status).toBe(200);
    const rows = (await get.json()) as Array<{ weightKg: number; note: string | null; source: string }>;
    expect(rows.some((r) => r.weightKg === 72.6 && r.note === "morning" && r.source === "manual")).toBe(true);
  });

  it("POST out-of-range weight (too low / too high) → 400", async () => {
    const low = await jsonPost(user, "/api/weight", { weightKg: 5 });
    expect(low.status).toBe(400);
    const high = await jsonPost(user, "/api/weight", { weightKg: 999 });
    expect(high.status).toBe(400);
  });

  it("PATCH /api/weight/{id} sets a note → 200", async () => {
    await jsonPost(user, "/api/weight", { weightKg: 70 });
    const rows = (await (await asUser(user, "/api/weight")).json()) as Array<{ id: number }>;
    const id = rows[0].id;
    const patch = await jsonPost(user, `/api/weight/${id}`, { note: "edited note" }, "PATCH");
    expect(patch.status).toBe(200);
    expect(await patch.json()).toEqual({ ok: true });
    const after = (await (await asUser(user, "/api/weight")).json()) as Array<{ id: number; note: string | null }>;
    expect(after.find((r) => r.id === id)?.note).toBe("edited note");
  });

  it("PATCH another user's reading → 404", async () => {
    await jsonPost("owner-a@example.com", "/api/weight", { weightKg: 80 });
    const rows = (await (await asUser("owner-a@example.com", "/api/weight")).json()) as Array<{ id: number }>;
    const id = rows[0].id;
    const patch = await jsonPost("intruder-b@example.com", `/api/weight/${id}`, { note: "nope" }, "PATCH");
    expect(patch.status).toBe(404);
  });
});

describe("measurements", () => {
  const user = "measure-user@example.com";

  it("POST valid → ok, GET includes it", async () => {
    const post = await jsonPost(user, "/api/measurements", { site: "waist", valueCm: 81.5 });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ ok: true });
    const rows = (await (await asUser(user, "/api/measurements")).json()) as Array<{ site: string; valueCm: number }>;
    expect(rows.some((r) => r.site === "waist" && r.valueCm === 81.5)).toBe(true);
  });

  it("POST invalid valueCm → 400", async () => {
    const tooBig = await jsonPost(user, "/api/measurements", { site: "waist", valueCm: 999 });
    expect(tooBig.status).toBe(400);
    const missingSite = await jsonPost(user, "/api/measurements", { valueCm: 50 });
    expect(missingSite.status).toBe(400);
  });
});

describe("nutrition", () => {
  const user = "nutrition-user@example.com";

  it("PUT a day's totals → ok, GET includes it", async () => {
    const put = await jsonPost(user, "/api/nutrition", { date: "2026-06-29", kcal: 2150, proteinG: 168 }, "PUT");
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true });
    const rows = (await (await asUser(user, "/api/nutrition")).json()) as Array<{ date: string; kcal: number | null }>;
    expect(rows.some((r) => r.date === "2026-06-29" && r.kcal === 2150)).toBe(true);
  });

  it("PUT bad date → 400", async () => {
    const bad = await jsonPost(user, "/api/nutrition", { date: "29-06-2026", kcal: 100 }, "PUT");
    expect(bad.status).toBe(400);
  });
});

describe("targets", () => {
  it("GET returns defaults on first read", async () => {
    const res = await asUser("targets-user@example.com", "/api/targets");
    expect(res.status).toBe(200);
    const t = (await res.json()) as {
      id: number;
      goalWeightKg: number;
      startWeightKg: number;
      dailyKcalTarget: number;
      proteinTargetG: number;
    };
    expect(t.goalWeightKg).toBe(66.7);
    expect(t.startWeightKg).toBe(72.6);
    expect(t.dailyKcalTarget).toBe(1850);
    expect(t.proteinTargetG).toBe(160);
    expect(typeof t.id).toBe("number");
  });
});

describe("dashboard", () => {
  it("returns the documented shape and computes shoulderToWaist", async () => {
    const user = "dash-user@example.com";
    const empty = await asUser(user, "/api/dashboard");
    expect(empty.status).toBe(200);
    const data = (await empty.json()) as Record<string, unknown>;
    // Documented top-level shape.
    expect(data).toHaveProperty("weight");
    expect(data).toHaveProperty("targets");
    expect(data).toHaveProperty("measurementsLatest");
    expect(data).toHaveProperty("shoulderToWaist");
    expect(data).toHaveProperty("nutritionToday");

    // Set shoulders + waist, then assert the ratio is computed.
    await jsonPost(user, "/api/measurements", { site: "shoulders", valueCm: 122 });
    await jsonPost(user, "/api/measurements", { site: "waist", valueCm: 80 });
    const after = (await (await asUser(user, "/api/dashboard")).json()) as { shoulderToWaist: number | null };
    expect(after.shoulderToWaist).toBeCloseTo(122 / 80, 5);
  });
});

describe("meals", () => {
  it("GET /api/nutrition/meals → [] when none", async () => {
    const res = await asUser("no-meals@example.com", "/api/nutrition/meals?date=2026-06-29");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("AI guard rails (no model call)", () => {
  const user = "ai-user@example.com";

  it("POST /api/nutrition/describe with empty text → 400 or 503 (never calls the model)", async () => {
    // With ANTHROPIC_API_KEY empty, the missing-key guard (503) runs before the
    // empty-text check (400). Either way, the model is never reached. We accept
    // both so the test holds whether or not a key is present in the env.
    const res = await jsonPost(user, "/api/nutrition/describe", { text: "" });
    expect([400, 503]).toContain(res.status);
  });

  it("missing-key path → 503 when ANTHROPIC_API_KEY is empty", async () => {
    const res = await jsonPost(user, "/api/nutrition/describe", { text: "two eggs" });
    // No key configured in the dev server → service unavailable, no model call.
    expect(res.status).toBe(503);
    // Read as text and parse defensively: the worker's body is the JSON error
    // envelope `{"error":"ai not configured"}`. The key assertion is that we got
    // the guard-rail (no model output, no items) — never a successful analysis.
    const body = await res.text();
    expect(body).toContain("ai not configured");
  });

  // Encode a FormData body into { body, contentType } so the multipart boundary
  // header travels with the request (dispatchFetch doesn't derive it for us).
  async function multipart(fd: FormData): Promise<{ body: ArrayBuffer; contentType: string }> {
    const req = new Request("http://x/", { method: "POST", body: fd });
    return { body: await req.arrayBuffer(), contentType: req.headers.get("content-type") ?? "" };
  }

  it("POST /api/nutrition/analyze with no photos → 400 (never calls the model)", async () => {
    // Empty multipart form: no `photos` fields. The file-count check runs before
    // the missing-key guard, so this is a deterministic 400.
    const { body, contentType } = await multipart(new FormData());
    const res = await asUser(user, "/api/nutrition/analyze?date=2026-06-29", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("no photos uploaded");
  });

  it("POST /api/agent with empty messages → 400 (never calls the model)", async () => {
    // The empty-messages check runs before the missing-key guard, so this is a
    // deterministic 400 regardless of whether a key is present in the env.
    const res = await jsonPost(user, "/api/agent", { messages: [] });
    expect(res.status).toBe(400);
  });

  it("POST /api/agent with a message but no key → 503 (never calls the model)", async () => {
    const res = await jsonPost(user, "/api/agent", {
      messages: [{ role: "user", content: "what do you think of a meat pie for breakfast?" }],
    });
    // Valid body, but ANTHROPIC_API_KEY is empty → guard-rail, no model call.
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("coach not configured");
  });

  it("POST /api/nutrition/analyze with a photo but no key → 503 (never calls the model)", async () => {
    const fd = new FormData();
    fd.append("photos", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }), "meal.jpg");
    const { body, contentType } = await multipart(fd);
    const res = await asUser(user, "/api/nutrition/analyze?date=2026-06-29", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    // Valid photo, but ANTHROPIC_API_KEY is empty → guard-rail, no model call.
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("vision not configured");
  });
});

describe("photo access control", () => {
  it("GET /api/nutrition/photo/<other-user-key> → 403", async () => {
    const res = await asUser(
      "photo-caller@example.com",
      `/api/nutrition/photo/${encodeURIComponent("other-owner@example.com/2026-06-29/some-uuid")}`,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("forbidden");
  });
});

// Auth enforcement (Better Auth session guard). With AUTH_DEV_BYPASS OFF the
// Worker behaves like the public production API: data routes require a session
// and 401 without one, while /api/auth/*, /api/health, and the token-authed
// scale ingest stay reachable.
describe("auth enforcement (no dev bypass)", () => {
  it("GET /api/dashboard → 401 without a session", async () => {
    const res = await workerFetchNoBypass(`/api/dashboard`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("GET /api/health → 200 without a session (unauthenticated probe)", async () => {
    const res = await workerFetchNoBypass(`/api/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("GET /api/auth/get-session → reachable (not gated) and returns JSON", async () => {
    const res = await workerFetchNoBypass(`/api/auth/get-session`);
    // No session ⇒ Better Auth answers 200 with a null session (never a crash/401).
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("POST /api/ingest/weight → 503 (token route stays reachable, not 401)", async () => {
    const res = await workerFetchNoBypass(`/api/ingest/weight`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weightKg: 72 }),
    });
    // INGEST_TOKEN is empty in tests ⇒ 503 "not configured"; the point is it is
    // NOT rejected by the session guard with a 401.
    expect(res.status).toBe(503);
  });
});

describe("openapi", () => {
  it("GET /openapi.json → 200 with openapi 3.1.0", async () => {
    const res = await workerFetch(`/openapi.json`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string };
    expect(doc.openapi).toBe("3.1.0");
  });
});

describe("per-user isolation", () => {
  it("user B never sees user A's weigh-in", async () => {
    await jsonPost("isolate-a@example.com", "/api/weight", { weightKg: 99.9, note: "A-only" });
    const bRows = (await (await asUser("isolate-b@example.com", "/api/weight")).json()) as Array<{
      weightKg: number;
      note: string | null;
    }>;
    expect(Array.isArray(bRows)).toBe(true);
    expect(bRows.some((r) => r.weightKg === 99.9 || r.note === "A-only")).toBe(false);
  });
});
