import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig "paths" so vi.mock("@/...") and dynamic imports resolve
    // to the same module ids as the static imports in app code.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    // Pure functions under lib/ are environment-agnostic; node is fastest.
    // Tests that need the DOM (hook tests under lib/hooks/, component tests)
    // opt in per file with a `// @vitest-environment jsdom` comment on their
    // first line.
    environment: "node",
    include: ["{lib,app,components}/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["{lib,app,components}/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}"],
      reporter: ["text", "html"],
    },
  },
});
