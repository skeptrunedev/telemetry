import { beforeEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import {
  STRIPE_WEBHOOK_SECRET,
  getMiniflareStripe,
  setStripeReply,
  stripeCalls,
  workerFetchBilling,
  workerFetchNoBypass,
  workerFetchStripe,
} from "./harness";

// Account deletion (DELETE /api/account).
//
// Deletion runs against the Stripe-faked instance: real D1 and R2, with every
// outbound call to api.stripe.com answered locally, so the test sees exactly
// which Stripe calls the Worker makes. Photon is unconfigured in tests, so the
// iMessage-registration step finds nothing to remove.

function as(email: string, init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("cf-access-authenticated-user-email", email);
  return { ...init, headers };
}

async function d1(mf: Miniflare) {
  return mf.getD1Database("DB");
}

/** Every table the account owns, with the column that ties a row to it. */
const OWNED: [table: string, column: "user_email" | "user_id" | "phone" | "conversation_id" | "identifier"][] = [
  ["weight_readings", "user_email"],
  ["measurements", "user_email"],
  ["photos", "user_email"],
  ["targets", "user_email"],
  ["nutrition_days", "user_email"],
  ["meals", "user_email"],
  ["nutrition_items", "user_email"],
  ["ingest_tokens", "user_email"],
  ["coach_conversations", "user_email"],
  ["coach_messages", "conversation_id"],
  ["api_keys", "user_email"],
  ["billing", "user_email"],
  ["linked_channels", "user_email"],
  ["agent_memories", "user_email"],
  ["workouts", "user_email"],
  ["reminders", "user_email"],
  ["agent_threads", "phone"],
  ["text_me_requests", "phone"],
  ["verification", "identifier"],
  ["session", "user_id"],
  ["account", "user_id"],
  ["oauth_access_token", "user_id"],
  ["oauth_consent", "user_id"],
  ["oauth_application", "user_id"],
  ["user", "user_id"],
];

type Seeded = { email: string; userId: string; phone: string; convId: string; r2Keys: string[] };

/** Put one row in every owned table plus R2 objects for `tag`'s account. */
async function seedAccount(mf: Miniflare, tag: string, stripeCustomerId: string | null): Promise<Seeded> {
  const db = await d1(mf);
  const email = `${tag}@example.com`;
  const userId = `user-${tag}`;
  const phone = `+1555${String(Math.abs(hash(tag))).padStart(7, "0").slice(0, 7)}`;
  const convId = `conv-${tag}`;
  const avatarId = `avatar-${tag}`;
  const mealKey = `${email}/2026-09-26/meal-${tag}`;
  const progressKey = `${email}/progress/progress-${tag}`;
  const chatKey = `${email}/agent/chat-${tag}`;
  const now = Date.now();
  const stmts = [
    db.prepare("INSERT INTO user (id, name, email, phone_number, image) VALUES (?1, ?2, ?3, ?4, ?5)").bind(
      userId,
      tag,
      email,
      phone,
      `/api/profile/avatar/${avatarId}`,
    ),
    db
      .prepare("INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES (?1, ?2, ?3, ?2, ?4)")
      .bind(`sess-${tag}`, now + 86_400_000, `token-${tag}`, userId),
    db
      .prepare("INSERT INTO account (id, account_id, provider_id, user_id, updated_at) VALUES (?1, ?2, 'phone', ?3, ?4)")
      .bind(`acct-${tag}`, userId, userId, now),
    db
      .prepare("INSERT INTO verification (id, identifier, value, expires_at) VALUES (?1, ?2, '123456', ?3)")
      .bind(`ver-${tag}`, phone, now + 600_000),
    db
      .prepare("INSERT INTO oauth_access_token (id, access_token, client_id, user_id) VALUES (?1, ?2, 'client', ?3)")
      .bind(`oat-${tag}`, `at-${tag}`, userId),
    db
      .prepare("INSERT INTO oauth_consent (id, user_id, client_id, scopes, consent_given) VALUES (?1, ?2, 'client', 'openid', 1)")
      .bind(`oc-${tag}`, userId),
    db
      .prepare("INSERT INTO oauth_application (id, client_id, name, redirect_urls, type, user_id) VALUES (?1, ?2, 'app', 'x', 'web', ?3)")
      .bind(`oa-${tag}`, `client-${tag}`, userId),
    db.prepare("INSERT INTO weight_readings (user_email, weight_kg) VALUES (?1, 80)").bind(email),
    db.prepare("INSERT INTO measurements (user_email, site, value_cm) VALUES (?1, 'waist', 80)").bind(email),
    db.prepare("INSERT INTO photos (user_email, r2_key) VALUES (?1, ?2)").bind(email, progressKey),
    db.prepare("INSERT INTO targets (user_email) VALUES (?1)").bind(email),
    db.prepare("INSERT INTO nutrition_days (user_email, date, kcal) VALUES (?1, '2026-09-26', 2000)").bind(email),
    db
      .prepare("INSERT INTO meals (id, user_email, date, photo_keys) VALUES (?1, ?2, '2026-09-26', ?3)")
      .bind(`meal-${tag}`, email, JSON.stringify([mealKey])),
    db
      .prepare(
        "INSERT INTO nutrition_items (user_email, meal_id, date, name, kcal, protein_g) VALUES (?1, ?2, '2026-09-26', 'eggs', 200, 18)",
      )
      .bind(email, `meal-${tag}`),
    db.prepare("INSERT INTO ingest_tokens (user_email, token_hash) VALUES (?1, 'h')").bind(email),
    db.prepare("INSERT INTO coach_conversations (id, user_email) VALUES (?1, ?2)").bind(convId, email),
    db.prepare("INSERT INTO coach_messages (conversation_id, role, content) VALUES (?1, 'user', 'hi')").bind(convId),
    db
      .prepare("INSERT INTO api_keys (id, user_email, name, token_hash, prefix) VALUES (?1, ?2, 'k', ?3, 'skcal_x')")
      .bind(`key-${tag}`, email, `hash-${tag}`),
    db
      .prepare("INSERT INTO billing (user_email, source, stripe_customer_id, status) VALUES (?1, 'stripe', ?2, 'active')")
      .bind(email, stripeCustomerId),
    db
      .prepare("INSERT INTO linked_channels (id, user_email, kind, value, verified_at) VALUES (?1, ?2, 'phone', ?3, ?4)")
      .bind(`ch-${tag}`, email, phone, now),
    db.prepare("INSERT INTO agent_memories (id, user_email, content) VALUES (?1, ?2, 'vegetarian')").bind(`mem-${tag}`, email),
    db
      .prepare("INSERT INTO workouts (id, user_email, summary, description) VALUES (?1, ?2, 'run', 'ran 5k')")
      .bind(`wo-${tag}`, email),
    db
      .prepare(
        "INSERT INTO reminders (id, user_email, instruction, hour, minute, tz, next_fire_at) VALUES (?1, ?2, 'log lunch', 12, 0, 'UTC', ?3)",
      )
      .bind(`rem-${tag}`, email, now),
    db.prepare("INSERT INTO agent_threads (id, phone, messages) VALUES (?1, ?2, '[]')").bind(`thr-${tag}`, phone),
    db.prepare("INSERT INTO text_me_requests (id, phone) VALUES (?1, ?2)").bind(`tm-${tag}`, phone),
  ];
  await db.batch(stmts);

  const r2 = await mf.getR2Bucket("PHOTOS");
  const r2Keys = [mealKey, progressKey, chatKey, `avatars/${avatarId}`];
  for (const k of r2Keys) await r2.put(k, "img");
  return { email, userId, phone, convId, r2Keys };
}

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

/** Rows still tied to the account, per table (tables with zero rows omitted). */
async function remainingRows(mf: Miniflare, a: Seeded): Promise<Record<string, number>> {
  const db = await d1(mf);
  const out: Record<string, number> = {};
  for (const [table, column] of OWNED) {
    const key =
      column === "user_email"
        ? a.email
        : column === "phone" || column === "identifier"
          ? a.phone
          : column === "conversation_id"
            ? a.convId
            : a.userId;
    const col = table === "user" ? "id" : column;
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${col} = ?1`).bind(key).first<{ n: number }>();
    if (row && row.n > 0) out[table] = row.n;
  }
  return out;
}

async function remainingObjects(mf: Miniflare, a: Seeded): Promise<string[]> {
  const r2 = await mf.getR2Bucket("PHOTOS");
  const left: string[] = [];
  for (const k of a.r2Keys) if (await r2.head(k)) left.push(k);
  return left;
}

beforeEach(() => {
  stripeCalls.length = 0;
  setStripeReply(() => new Response(JSON.stringify({ id: "cus_x", deleted: true }), { status: 200 }));
});

describe("DELETE /api/account", () => {
  it("erases every owned row and R2 object, deletes the Stripe customer, and leaves other accounts alone", async () => {
    const mf = await getMiniflareStripe();
    const victim = await seedAccount(mf, "delete-me", "cus_deleteme");
    const bystander = await seedAccount(mf, "keep-me", "cus_keepme");

    // Seeding really did touch every owned table.
    expect(Object.keys(await remainingRows(mf, victim)).sort()).toEqual(OWNED.map(([t]) => t).sort());

    const res = await workerFetchStripe("/api/account", as(victim.email, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(stripeCalls).toEqual([{ method: "DELETE", url: "https://api.stripe.com/v1/customers/cus_deleteme" }]);
    expect(await remainingRows(mf, victim)).toEqual({});
    expect(await remainingObjects(mf, victim)).toEqual([]);

    expect(Object.keys(await remainingRows(mf, bystander)).sort()).toEqual(OWNED.map(([t]) => t).sort());
    expect(await remainingObjects(mf, bystander)).toEqual(bystander.r2Keys);
  });

  it("treats a Stripe customer that is already gone as cancelled", async () => {
    const mf = await getMiniflareStripe();
    const a = await seedAccount(mf, "stripe-gone", "cus_gone");
    setStripeReply(
      () =>
        new Response(JSON.stringify({ error: { code: "resource_missing", message: "No such customer: 'cus_gone'" } }), {
          status: 404,
        }),
    );
    const res = await workerFetchStripe("/api/account", as(a.email, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(await remainingRows(mf, a)).toEqual({});
  });

  it("keeps every row when Stripe refuses, so a delete never leaves a live subscription behind", async () => {
    const mf = await getMiniflareStripe();
    const a = await seedAccount(mf, "stripe-down", "cus_down");
    setStripeReply(() => new Response(JSON.stringify({ error: { message: "api down" } }), { status: 500 }));
    const res = await workerFetchStripe("/api/account", as(a.email, { method: "DELETE" }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("api down");
    expect(Object.keys(await remainingRows(mf, a)).length).toBe(OWNED.length);
    expect(await remainingObjects(mf, a)).toEqual(a.r2Keys);
  });

  it("deletes an account that never had billing without calling Stripe", async () => {
    const mf = await getMiniflareStripe();
    const a = await seedAccount(mf, "no-billing", null);
    const res = await workerFetchStripe("/api/account", as(a.email, { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(stripeCalls).toEqual([]);
    expect(await remainingRows(mf, a)).toEqual({});
  });

  it("refuses API keys", async () => {
    const created = await workerFetchStripe(
      "/api/keys",
      as("key-holder@example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "full" }),
      }),
    );
    const { token } = (await created.json()) as { token: string };
    const res = await workerFetchStripe("/api/account", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("answers 401 without a session", async () => {
    const res = await workerFetchNoBypass("/api/account", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("stays reachable for an unsubscribed account (never 402)", async () => {
    const res = await workerFetchBilling(
      "/api/account",
      as("+15550001111@phone.skcal.fit", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("Stripe webhook after deletion", () => {
  async function signed(payload: string): Promise<RequestInit> {
    const t = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
    const v1 = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { method: "POST", headers: { "stripe-signature": `t=${t},v1=${v1}` }, body: payload };
  }

  it("does not recreate a billing row for an erased email", async () => {
    const mf = await getMiniflareStripe();
    const a = await seedAccount(mf, "webhook-erased", "cus_erased");
    expect((await workerFetchStripe("/api/account", as(a.email, { method: "DELETE" }))).status).toBe(200);

    const payload = JSON.stringify({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_erased", customer: "cus_erased", status: "canceled", metadata: { user_email: a.email } } },
    });
    const res = await workerFetchStripe("/api/stripe/webhook", await signed(payload));
    expect(res.status).toBe(200);
    const row = await (await d1(mf)).prepare("SELECT COUNT(*) AS n FROM billing WHERE user_email = ?1").bind(a.email).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("still records a subscription for a live account found only by metadata", async () => {
    const mf = await getMiniflareStripe();
    const email = "webhook-live@example.com";
    await (await d1(mf)).prepare("INSERT INTO user (id, name, email) VALUES ('user-webhook-live', 'live', ?1)").bind(email).run();
    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_live", customer: "cus_live", status: "active", metadata: { user_email: email } } },
    });
    expect((await workerFetchStripe("/api/stripe/webhook", await signed(payload))).status).toBe(200);
    const row = await (await d1(mf))
      .prepare("SELECT status FROM billing WHERE user_email = ?1 AND source = 'stripe'")
      .bind(email)
      .first<{ status: string }>();
    expect(row?.status).toBe("active");
  });
});
