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
// Track the visual viewport so the chat view can shrink with the on-screen
// keyboard (100dvh does NOT shrink when the iOS keyboard opens).
const vv = window.visualViewport;
if (vv) {
  const setVvh = () => {
    document.documentElement.style.setProperty("--vvh", `${vv.height}px`);
    // iOS nudges the layout viewport when the keyboard opens; pin it back so
    // the shrunken app stays aligned to the top.
    if (window.scrollY !== 0 && document.querySelector(".shell-coach")) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", setVvh);
  setVvh();
}

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
