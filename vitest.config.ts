import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure functions under lib/ are environment-agnostic; node is fastest.
    // Switch to "jsdom" only if/when a test needs the DOM (e.g. canvas).
    environment: "node",
    include: ["lib/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts"],
      reporter: ["text", "html"],
    },
  },
});
