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
    // Switch to "jsdom" only if/when a test needs the DOM (e.g. canvas).
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
