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
        // CRITICAL: never serve the HTML shell from the service worker. A
        // cache-first shell on a frequently redeployed app goes stale and
        // references asset hashes that have since 404'd, breaking the page.
        // Denying ALL navigations means they always hit the network (the Worker
        // serves index.html with no-cache), while hashed build assets stay
        // precached for speed — which also keeps the app installable.
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
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
});
