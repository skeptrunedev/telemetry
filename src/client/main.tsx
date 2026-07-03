import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

// PWA service worker: precaches hashed assets (and makes the app installable),
// but NEVER serves the HTML shell — navigations always hit the network (see
// navigateFallbackDenylist in vite.config.ts), so deploys can't leave a stale
// shell pointing at 404'd asset hashes. Register + poll for updates (on load,
// every 30 min, and when the tab regains focus) and apply them immediately.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    });
  },
  onNeedRefresh() {
    updateSW(true);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
