import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import App from "./App";
import "./index.css";

// Keep the installed PWA fresh after a deploy: register the service worker,
// poll for a new version (on load, every 30 min, and when the tab regains
// focus), and apply + reload as soon as one is found.
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
