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
        // Never precache HTML: the precache route maps / to index.html even
        // when the navigation fallback is denied. An old shell can outlive
        // its hashed assets across a deploy and leave the page blank.
        // Keep hashed assets cached, but fetch the shell from the Worker,
        // which serves HTML with no-cache.
        globIgnores: ["**/*.html"],
        navigateFallback: null,
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
