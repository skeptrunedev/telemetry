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
      title: "skcal API",
      version: pkg.version && pkg.version !== "0.0.0" ? pkg.version : "1.0.0",
      summary: "Typed HTTP API for skcal — calorie and body-composition tracking, built to wire into developer + AI tooling.",
      description:
        "HTTP API behind [skcal](https://app.skcal.fit), a calorie and body-composition tracker " +
        "built for developers and AI power users — drive it from the CLI or straight from this typed API " +
        "(MCP server planned).\n\n" +
        "Every record is scoped to the signed-in account's email, so one account can never read another's " +
        "data. The scale-ingest route is the one exception — it is authenticated with a bearer token and " +
        "attributes readings to a configured owner.\n\n" +
        "Nutrition is logged from a freeform text description, which is sent to Claude, " +
        "which returns per-item calories and protein.",
      contact: { name: "Nick Khami", url: "https://app.skcal.fit", email: "nick@mintlify.com" },
      license: { name: "MIT", url: "https://opensource.org/license/mit" },
    },
    servers: [
      { url: "https://app.skcal.fit", description: "Production" },
      { url: "http://localhost:5173", description: "Local development" },
    ],
    tags: [
      { name: "Service", description: "Liveness and identity probes." },
      { name: "Weight", description: "Body-weight readings and per-reading notes." },
      { name: "Measurements", description: "Body-part circumference measurements (stored in centimetres)." },
      { name: "Nutrition", description: "Per-day calorie and protein totals plus AI meal logging." },
      { name: "Targets", description: "Per-user goals: target weight, calories, and protein." },
      { name: "Coach", description: "AI coach chat grounded in the caller's targets, intake, and weight trend." },
      { name: "Dashboard", description: "Pre-aggregated snapshot powering the home screen." },
      { name: "Ingest", description: "Token-authenticated machine ingest from the Bluetooth scale listener." },
      { name: "Spec", description: "The OpenAPI document itself." },
    ],
    security: [{ sessionCookie: [] }, { bearerApiKey: [] }],
  },
  apis: [resolve(root, "src/worker/index.ts"), resolve(root, "src/db/schema.ts")],
};

const spec = swaggerJsdoc(options);
const out = resolve(root, "src/worker/openapi.gen.json");
writeFileSync(out, JSON.stringify(spec, null, 2) + "\n");

const pathCount = Object.keys(spec.paths ?? {}).length;
const schemaCount = Object.keys(spec.components?.schemas ?? {}).length;
console.log(`openapi: wrote ${out} — ${pathCount} paths, ${schemaCount} schemas`);
