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
    // Tests that need the DOM (React hook tests under lib/hooks/) opt in per
    // file with a `// @vitest-environment jsdom` comment on their first line.
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts"],
      reporter: ["text", "html"],
    },
  },
});
