import { defineConfig } from "vitest/config";

// Worker API integration tests.
//
// PREFERRED approach was @cloudflare/vitest-pool-workers (the worker runs inside
// workerd via the dedicated Vitest pool). The tests were written and PASS under
// it, BUT the pool's bundled workerd build segfaults (SIGSEGV with an
// infinite-recursion frame) during its teardown on this host, which makes
// vitest exit non-zero even though every assertion passes. After a genuine
// effort (toggling singleWorker / isolatedStorage / the sandbox) the crash
// proved to be in the POOL's teardown specifically — plain Miniflare with the
// same workerd, D1 and R2 disposes cleanly here, the pool does not.
//
// So we run the SAME workerd runtime ourselves: test/harness.ts bundles the real
// Worker with esbuild and drives it through Miniflare with real D1/R2 bindings
// (see that file). This stays in-process, fast, network-free and secret-free,
// and disposes cleanly. The tests are transport-agnostic, so if a future
// pool-workers/workerd release fixes the teardown crash, they can be pointed
// back at SELF.fetch with no assertion changes.
export default defineConfig({
  test: {
    // Only the root worker tests; the CLI has its own vitest project.
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    // esbuild bundle + Miniflare startup happens on the first request.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
