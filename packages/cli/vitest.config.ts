import { defineConfig } from "vitest/config";

// Plain Node tests for the CLI (config/client/auth). This local config exists
// so vitest does NOT walk up and inherit the repo-root config, which uses the
// Cloudflare Workers pool — these tests must run in a normal Node environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
