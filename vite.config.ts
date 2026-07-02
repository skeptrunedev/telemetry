import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false, // we register manually in main.tsx to add update polling
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Never serve the HTML shell from the service worker: deny ALL navigations
        // from the precache fallback so they always hit the network (the Worker
        // serves index.html with no-cache). This is the key robustness fix — a
        // frequently redeployed app must never show a stale cached shell that
        // references asset hashes that have since 404'd. Hashed build assets are
        // still precached for speed (they're immutable per hash).
        navigateFallbackDenylist: [/./],
      },
      manifest: {
        name: "skcal",
        short_name: "skcal",
        description: "Calorie + body-composition tracker for developers and AI power users",
        theme_color: "#0B0B0C",
        background_color: "#0B0B0C",
        display: "standalone",
        start_url: "/",
        icons: [],
      },
    }),
  ],
});
