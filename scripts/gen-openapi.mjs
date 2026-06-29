// Assembles the OpenAPI document from the `@openapi` JSDoc comments that live
// next to the code they describe: route docs in src/worker/index.ts, data
// models + shared responses + security schemes in src/db/schema.ts.
//
// The spec-level config (info / servers / tags / global security) lives here
// because it isn't tied to any one route. Everything else is comment-driven.
//
// Output: src/worker/openapi.gen.json — imported and served by the Worker at
// /openapi.json. Run via `npm run openapi:gen` (also runs automatically as a
// `prebuild` step). Lint with `npm run openapi:lint` (quobix vacuum).
import swaggerJsdoc from "swagger-jsdoc";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

/** @type {import('swagger-jsdoc').Options} */
const options = {
  definition: {
    openapi: "3.1.0",
    info: {
      title: "Telemetry API",
      version: pkg.version && pkg.version !== "0.0.0" ? pkg.version : "1.0.0",
      summary: "Single-user body-recomposition tracking: weight, measurements, and AI nutrition logging.",
      description:
        "HTTP API behind [Telemetry](https://telemetry.skeptrune.com), a body-recomposition tracker.\n\n" +
        "All routes are gated by Cloudflare Access: the verified identity arrives as the " +
        "`Cf-Access-Authenticated-User-Email` request header and every record is scoped to that email, " +
        "so one account can never read another's data. The scale-ingest route is the one exception — it " +
        "is authenticated with a bearer token and attributes readings to a configured owner.\n\n" +
        "Nutrition can be logged from a photo, a before/after photo pair, or a freeform text description; " +
        "each is sent to Claude, which returns per-item calories and protein.",
      contact: { name: "Nick Khami", url: "https://telemetry.skeptrune.com", email: "nick@mintlify.com" },
      license: { name: "MIT", url: "https://opensource.org/license/mit" },
    },
    servers: [
      { url: "https://telemetry.skeptrune.com", description: "Production" },
      { url: "http://localhost:5173", description: "Local development" },
    ],
    tags: [
      { name: "Service", description: "Liveness and identity probes." },
      { name: "Weight", description: "Body-weight readings and per-reading notes." },
      { name: "Measurements", description: "Body-part circumference measurements (stored in centimetres)." },
      { name: "Nutrition", description: "Per-day calorie and protein totals plus AI meal logging." },
      { name: "Targets", description: "Per-user goals: target weight, calories, and protein." },
      { name: "Dashboard", description: "Pre-aggregated snapshot powering the home screen." },
      { name: "Ingest", description: "Token-authenticated machine ingest from the Bluetooth scale listener." },
      { name: "Spec", description: "The OpenAPI document itself." },
    ],
    security: [{ cloudflareAccess: [] }],
  },
  apis: [resolve(root, "src/worker/index.ts"), resolve(root, "src/db/schema.ts")],
};

const spec = swaggerJsdoc(options);
const out = resolve(root, "src/worker/openapi.gen.json");
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");

const pathCount = Object.keys(spec.paths ?? {}).length;
const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
console.log(`openapi: wrote ${out} — ${pathCount} paths, ${schemaCount} schemas`);
