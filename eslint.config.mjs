import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".claude/**", ".next*/**", "cloudflare/media-worker/worker-configuration.d.ts", "coverage/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "react-hooks/set-state-in-effect": "error",
    },
  },
  // Type-aware rules for the async mistakes plain linting cannot see: a
  // promise nobody awaits swallows its rejection, and a union that gains a
  // member silently falls through a switch that was written before it.
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["cloudflare/**"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      // Async event handlers on JSX attributes are the app's normal pattern.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
];

export default eslintConfig;
