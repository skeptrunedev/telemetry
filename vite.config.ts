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
      manifest: {
        name: "Telemetry",
        short_name: "Telemetry",
        description: "Body recomp tracker",
        theme_color: "#0B0B0C",
        background_color: "#0B0B0C",
        display: "standalone",
        start_url: "/",
        icons: [],
      },
    }),
  ],
});
