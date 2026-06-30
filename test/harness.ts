import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
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

async function bundleWorker(): Promise<string> {
  const out = await build({
    entryPoints: [join(__dirname, "..", "src", "worker", "index.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    // Resolve workerd/worker entry points the way the production build does.
    conditions: ["workerd", "worker", "browser"],
    // workerd provides node: builtins via nodejs_compat; keep them external.
    external: ["node:*", "cloudflare:*"],
    write: false,
    logLevel: "silent",
  });
  return out.outputFiles[0].text;
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
      const s = stmt.trim();
      if (s) await db.exec(s.replace(/\n/g, " "));
    }
  }
}

/** Lazily build + start the Worker once, applying migrations to its D1. */
export async function getMiniflare(): Promise<Miniflare> {
  if (mf) return mf;
  const script = await bundleWorker();
  mf = new Miniflare({
    modules: true,
    script,
    modulesRoot: join(__dirname, ".."),
    compatibilityDate: "2026-06-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: ":memory:" },
    r2Buckets: ["PHOTOS"],
    // Force the AI/ingest secrets empty so tests ALWAYS take the guard-rail
    // paths and never reach Anthropic.
    bindings: { ANTHROPIC_API_KEY: "", INGEST_TOKEN: "" },
    // The Worker's SPA fallback hits env.ASSETS; stub it so non-API paths resolve.
    serviceBindings: { ASSETS: () => new Response("spa", { status: 200 }) },
  });
  await applyMigrations(mf);
  return mf;
}

/** Dispatch a request to the in-process Worker. */
export async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const instance = await getMiniflare();
  // Miniflare's dispatchFetch returns its own Response type; cast for ergonomics.
  return instance.dispatchFetch(`http://example.com${path}`, init as never) as unknown as Promise<Response>;
}

/** Tear down the shared instance (called from a global afterAll). */
export async function disposeMiniflare(): Promise<void> {
  if (mf) {
    await mf.dispose();
    mf = undefined;
  }
}
