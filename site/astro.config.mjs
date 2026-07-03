import { defineConfig } from "astro/config";

// Static landing site for skcal.fit — built to ./dist and served as Cloudflare
// Worker static assets (see wrangler.jsonc). The app itself lives at
// app.skcal.fit in the repo root.
export default defineConfig({
  site: "https://skcal.fit",
});
