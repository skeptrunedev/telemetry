import { defineConfig } from "tsup";

// Bundle to a single CommonJS file so it runs under plain Node and can be
// compiled to standalone binaries by pkg. The shebang on src/index.ts is
// preserved by tsup.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node18",
  clean: true,
  minify: false,
  outExtension: () => ({ js: ".js" }),
});
