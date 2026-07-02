import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// No PWA/service worker: the app is served fresh from the network every load.
// A cached SW shell repeatedly went stale after deploys (referencing 404'd
// asset hashes) and broke styling; the Worker serves /sw.js as a kill-switch to
// tear down any worker that's still registered on a visitor's browser.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
