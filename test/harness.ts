import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// In-process Worker test harness.
//
// We bundle the real Worker (src/worker/index.ts) with esbuild and run it inside
// Miniflare with REAL D1 (`DB`) and R2 (`PHOTOS`) bindings, then drive it via
// `dispatchFetch`. This is functionally the same as @cloudflare/vitest-pool-workers
// (the preferred path) — same workerd runtime, same bindings — but we drive
// Miniflare directly because the pool's bundled workerd build segfaults on this
// host during its teardown (an intrinsic workerd-build teardown bug, not a
// config problem: plain Miniflare with D1/R2 disposes cleanly here, the pool
// does not). Driving Miniflare ourselves disposes cleanly and keeps everything
// in-process, fast, network-free, and secret-free.
//
// `ANTHROPIC_API_KEY` and `INGEST_TOKEN` are bound to empty strings so the AI
// routes hit their guard-rail (503) paths and never call the model.

let mf: Miniflare | undefined;

// Bundle the Worker to a temp dir. We use code SPLITTING (not a single string)
// because better-auth ships static-specifier dynamic imports (its lazy
// kysely/dialect adapters); a single-file bundle leaves an unresolved
// `import(...)` that Miniflare can't load from an inline `script`. Splitting
// emits the chunks as sibling files with relative specifiers, and Miniflare
// resolves them from disk via `scriptPath` + `modulesRoot`.
async function bundleWorker(): Promise<{ scriptPath: string; modulesRoot: string }> {
  const outdir = mkdtempSync(join(tmpdir(), "telemetry-worker-"));
  await build({
    entryPoints: [join(__dirname, "..", "src", "worker", "index.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    // Resolve workerd/worker entry points the way the production build does.
    conditions: ["workerd", "worker", "browser"],
    // Prefer ESM entry points (e.g. worker-mailer ships a CJS `main` that does
    // `require("cloudflare:sockets")` — unsupported in workerd — and an ESM
    // `module` that imports it properly). This matches what vite/wrangler pick.
    mainFields: ["module", "main"],
    // workerd provides node: builtins via nodejs_compat; keep them external.
    external: ["node:*", "cloudflare:*"],
    splitting: true,
    outdir,
    write: true,
    logLevel: "silent",
    plugins: [
      {
        // better-auth's Kysely adapter has DB-dialect auto-detection that does
        // `await import(variable)` (e.g. "node:sqlite"). Miniflare's static
        // module walk can't resolve a non-literal dynamic import and errors out.
        // We use the Drizzle adapter, so the Kysely path is never reached at
        // runtime — stub the module to an empty object so it drops from the
        // dependency graph. (This is a test-harness bundling detail only; the
        // production vite/wrangler build is unaffected.)
        name: "stub-better-auth-kysely",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /@better-auth\/kysely-adapter$/ }, (args) => ({
            path: args.path,
            namespace: "stub-kysely",
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "stub-kysely" }, () => ({
            // Provide the named exports better-auth imports, as throwing stubs.
            // With the Drizzle adapter configured these are never invoked.
            contents:
              "const unreachable = () => { throw new Error('kysely adapter stubbed out in tests'); };\n" +
              "export const createKyselyAdapter = unreachable;\n" +
              "export const getKyselyDatabaseType = unreachable;\n" +
              "export const kyselyAdapter = unreachable;\n",
            loader: "js",
          }));
        },
      },
    ],
  });
  return { scriptPath: join(outdir, "index.js"), modulesRoot: outdir };
}

async function applyMigrations(instance: Miniflare): Promise<void> {
  const dir = join(__dirname, "..", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const db = await instance.getD1Database("DB");
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    // Drizzle's generated migrations separate statements with this marker.
    for (const stmt of sql.split("--> statement-breakpoint")) {
      // D1's exec() wants one statement per line, so newlines collapse to
      // spaces — which would make a leading `-- comment` swallow the statement
      // behind it. Drop whole-line comments first. (wrangler parses the SQL
      // properly and needs none of this; it's a harness-only quirk.)
      const s = stmt
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join(" ")
        .trim();
      if (s) await db.exec(s);
    }
  }
}

let mfNoBypass: Miniflare | undefined;
let bundlePromise: Promise<{ scriptPath: string; modulesRoot: string }> | undefined;

function bundleOnce() {
  if (!bundlePromise) bundlePromise = bundleWorker();
  return bundlePromise;
}

// Shared bindings. `bypass` toggles AUTH_DEV_BYPASS: with it (default) requests
// run unauthenticated (identity from the cf-access-authenticated-user-email
// header, else dev@local); without it, the Worker mimics production and rejects
// sessionless data requests with 401. BETTER_AUTH_SECRET keeps makeAuth()
// constructible; the AI/ingest secrets are empty so those routes take their
// guard-rail paths and never reach Anthropic.
function bindings(bypass: boolean, extra: Record<string, string> = {}) {
  return {
    ANTHROPIC_API_KEY: "",
    INGEST_TOKEN: "",
    ...(bypass ? { AUTH_DEV_BYPASS: "1" } : {}),
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-32",
    BETTER_AUTH_URL: "http://example.com",
    ...extra,
  };
}

async function makeInstance(bypass: boolean, extra: Record<string, string> = {}): Promise<Miniflare> {
  const { scriptPath, modulesRoot } = await bundleOnce();
  const instance = new Miniflare({
    modules: true,
    scriptPath,
    modulesRoot,
    // esbuild emits the split chunks as `.js`; without this rule Miniflare would
    // treat sibling `.js` files as CommonJS and fail to parse their ESM syntax.
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: ":memory:" },
    r2Buckets: ["PHOTOS"],
    bindings: bindings(bypass, extra),
    // The Worker's SPA fallback hits env.ASSETS; stub it so non-API paths resolve.
    serviceBindings: { ASSETS: () => new Response("spa", { status: 200 }) },
  });
  await applyMigrations(instance);
  return instance;
}

/** Lazily build + start the Worker once, applying migrations to its D1. */
export async function getMiniflare(): Promise<Miniflare> {
  if (!mf) mf = await makeInstance(true);
  return mf;
}

/** A second instance with AUTH_DEV_BYPASS OFF — mimics the public production API. */
async function getMiniflareNoBypass(): Promise<Miniflare> {
  if (!mfNoBypass) mfNoBypass = await makeInstance(false);
  return mfNoBypass;
}

/** Dispatch a request to the in-process Worker (dev-bypass ON). */
export async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const instance = await getMiniflare();
  // Miniflare's dispatchFetch returns its own Response type; cast for ergonomics.
  return instance.dispatchFetch(`http://example.com${path}`, init as never) as unknown as Promise<Response>;
}

/** Dispatch a request to the production-like Worker (dev-bypass OFF ⇒ 401 without a session). */
export async function workerFetchNoBypass(path: string, init: RequestInit = {}): Promise<Response> {
  const instance = await getMiniflareNoBypass();
  return instance.dispatchFetch(`http://example.com${path}`, init as never) as unknown as Promise<Response>;
}

// A third instance with a (fake) STRIPE_SECRET_KEY bound, which is what turns
// the subscription gate ON. Dev bypass stays on, and the Worker deliberately
// does NOT exempt @phone.skcal.fit accounts from the gate, so those emails are
// how these tests reach the real 402 path.
let mfBilling: Miniflare | undefined;

async function getMiniflareBilling(): Promise<Miniflare> {
  if (!mfBilling) mfBilling = await makeInstance(true, { STRIPE_SECRET_KEY: "sk_test_not_a_real_key" });
  return mfBilling;
}

/** Dispatch to the Worker with the subscription gate live. */
export async function workerFetchBilling(path: string, init: RequestInit = {}): Promise<Response> {
  const instance = await getMiniflareBilling();
  return instance.dispatchFetch(`http://example.com${path}`, init as never) as unknown as Promise<Response>;
}

/** Write a `billing` row straight into that instance's D1, bypassing any route. */
export async function seedBillingRow(row: {
  userEmail: string;
  source: "stripe" | "apple";
  status: string | null;
  currentPeriodEnd?: number | null;
  subscriptionId?: string | null;
}): Promise<void> {
  const db = await (await getMiniflareBilling()).getD1Database("DB");
  await db
    .prepare(
      "INSERT INTO billing (user_email, source, subscription_id, status, current_period_end, updated_at)" +
        " VALUES (?1, ?2, ?3, ?4, ?5, ?6)" +
        " ON CONFLICT(user_email, source) DO UPDATE SET subscription_id = ?3, status = ?4, current_period_end = ?5, updated_at = ?6",
    )
    .bind(row.userEmail, row.source, row.subscriptionId ?? null, row.status, row.currentPeriodEnd ?? null, Date.now())
    .run();
}

/** Tear down the shared instances (called from a global afterAll). */
export async function disposeMiniflare(): Promise<void> {
  if (mf) {
    await mf.dispose();
    mf = undefined;
  }
  if (mfNoBypass) {
    await mfNoBypass.dispose();
    mfNoBypass = undefined;
  }
  if (mfBilling) {
    await mfBilling.dispose();
    mfBilling = undefined;
  }
}
