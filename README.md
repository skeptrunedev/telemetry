# skcal

[![CI](https://github.com/skeptrunedev/telemetry/actions/workflows/ci.yml/badge.svg)](https://github.com/skeptrunedev/telemetry/actions/workflows/ci.yml)

A calorie and body-composition tracker built for **developers and AI power
users** — weight, body circumferences, progress photos, and daily nutrition —
that you drive from a **CLI** and a **typed HTTP API (OpenAPI)** so you can wire
it straight into your own tooling. (An MCP server is planned; the CLI + API are
what's real today.) Mobile-first installable PWA, optional hardware
auto-capture, and **zero third-party cloud** in the data path. Built to deploy
on Cloudflare.

## Stack

- **React 19 + Vite 6**, installable PWA (`vite-plugin-pwa`, offline shell)
- **Hono** API on a single **Cloudflare Worker** (serves the SPA + `/api/*`)
- **Cloudflare D1** (SQLite) + **Drizzle ORM**
- **Cloudflare R2** for progress photos
- Auth via **Better Auth** (Google + email magic link); the scale-ingest
  endpoint uses a bearer token

## Optional hardware capture

- **Weight** — an [Etekcity ESF-551](https://github.com/oliexdev/openScale) BLE scale read
  locally by a small Python listener that `POST`s to `/api/ingest/weight`. No vendor app/cloud.
- **Circumferences** — a RENPHO RF-BMF01 BLE tape measure read in-browser via the
  **Web Bluetooth API** (Android/Chromium/Linux). No vendor app/cloud.

Body fat % (BIA) is captured when available but treated as a noisy, trend-only signal —
weight (weekly average) and circumferences are the metrics that matter.

## Develop

```bash
npm install
npm run dev              # http://localhost:5173
npm run build
npm run typecheck
npm run db:generate      # generate a D1 migration from src/db/schema.ts
npm run db:migrate:local # apply migrations to the local D1
```

## API & OpenAPI

The HTTP API is documented in-code: each route carries an `@openapi` JSDoc
comment (in `src/worker/index.ts`), and the shared data models live as
`@openapi` component comments next to the Drizzle tables (`src/db/schema.ts`).
A build step assembles them into a single OpenAPI 3.1 document.

```bash
npm run openapi:gen      # comments -> src/worker/openapi.gen.json (also runs on prebuild)
npm run openapi:lint     # quobix vacuum, gated at a perfect 100/100 score
```

The generated spec is served by the Worker at **`/openapi.json`**
([live](https://skcal.skeptrune.com/openapi.json)). CI regenerates the spec,
fails if the committed copy drifted from the comments, and holds the vacuum
score at 100.

## CLI

A terminal client lives in [`packages/cli`](./packages/cli) and ships to npm as
**`@skeptrune/skcal`** (plus standalone binaries on each GitHub Release).

```bash
npm install -g @skeptrune/skcal
skcal login
skcal status
skcal weight log 158.2 --note "morning, fasted"
skcal meal describe "chicken breast + toum, skipped the salad"
```

## Deploy (Cloudflare)

```bash
npx wrangler login
npx wrangler d1 create telemetry-db   # paste the database_id into wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

## License

[MIT](./LICENSE)
