import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// No service worker: the app is always served fresh from the network. A stale
// SW previously served an outdated HTML shell pointing at 404'd asset hashes,
// which broke styling after deploys. The Worker serves /sw.js as a kill-switch
// so any previously-registered worker unregisters itself and reloads.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
