import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".next/**", ".next-e2e/**", "cloudflare/media-worker/worker-configuration.d.ts", "coverage/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "react-hooks/set-state-in-effect": "error",
    },
  },
];

export default eslintConfig;
