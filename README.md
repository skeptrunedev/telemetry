# Telemetry

A single-user, mobile-first **PWA for tracking body recomposition** — weight,
body circumferences, progress photos, and daily nutrition adherence — with
optional hardware auto-capture and **zero third-party cloud** in the data path.
Built to deploy on Cloudflare.

## Stack

- **React 19 + Vite 6**, installable PWA (`vite-plugin-pwa`, offline shell)
- **Hono** API on a single **Cloudflare Worker** (serves the SPA + `/api/*`)
- **Cloudflare D1** (SQLite) + **Drizzle ORM**
- **Cloudflare R2** for progress photos
- Auth via **Cloudflare Access** (the scale-ingest endpoint uses a service token)

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

## Deploy (Cloudflare)

```bash
npx wrangler login
npx wrangler d1 create telemetry-db   # paste the database_id into wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

## License

[MIT](./LICENSE)
