import { afterAll } from "vitest";
import { disposeMiniflare } from "./harness";

// Dispose the shared in-process Worker (Miniflare) once, after all tests.
afterAll(async () => {
  await disposeMiniflare();
});
