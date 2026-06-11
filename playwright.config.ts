import { defineConfig, devices } from "@playwright/test";

// The suite runs against a production build of the app in demo mode
// (no Supabase), served on its own port and dist dir so it never collides
// with a `next dev` instance using .next on :3000.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Pixel 7 keeps the mobile project on chromium, so CI installs one browser.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run e2e:serve",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Demo-mode flag is inlined at build time and only honored on localhost.
      NEXT_PUBLIC_LOCAL_DEMO_MODE: "1",
      NEXT_DIST_DIR: ".next-e2e",
      PORT: "3100",
    },
  },
});
