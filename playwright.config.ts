import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// The suite runs against production builds of the app in demo mode (no Neon
// or R2), each served on its own port and dist dir so it never collides with a
// `next dev` instance using .next on :3000.
//
// Two builds, because the Mapbox token is inlined at build time:
//  - :3100 has no token. The desktop and mobile projects assert on the app
//    shell and data flows, deterministically and with no network.
//  - :3101 has a token. The map project drives the real map: markers, camera,
//    popups, and what Journey Mode does to them. It needs the network and a
//    token, so it only exists when one is available (see mapToken below).

function localEnvValue(name: string): string {
  if (!existsSync(".env.local")) return "";
  const line = readFileSync(".env.local", "utf8").split("\n").find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

// CI passes the E2E_MAPBOX_TOKEN secret; locally the token a developer already
// has in .env.local is used. Without either, the map project is left out and
// the run says so, rather than failing on a missing secret (forks, Dependabot).
const mapToken = process.env.E2E_MAPBOX_TOKEN || localEnvValue("NEXT_PUBLIC_MAPBOX_TOKEN");
if (!mapToken) console.warn("No Mapbox token: skipping the real-map e2e project. Set E2E_MAPBOX_TOKEN to run it.");

const demoServer = (port: number, distDir: string, token: string) => ({
  command: "npm run e2e:serve",
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
  env: {
    // Demo-mode flag is inlined at build time and only honored on localhost.
    NEXT_PUBLIC_LOCAL_DEMO_MODE: "1",
    // Set explicitly in both builds so a developer's .env.local can never
    // change which one has a map.
    NEXT_PUBLIC_MAPBOX_TOKEN: token,
    NEXT_DIST_DIR: distDir,
    PORT: String(port),
  },
});

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
    { name: "desktop", grep: /@desktop/, use: { ...devices["Desktop Chrome"] } },
    // Pixel 7 keeps the mobile project on chromium, so CI installs one browser.
    { name: "mobile", grep: /@mobile/, use: { ...devices["Pixel 7"] } },
    ...(mapToken ? [{
      name: "map",
      grep: /@map/,
      // Map tests wait on tiles and camera flights.
      timeout: 60_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3101",
        // Headless Chromium has no GPU; SwiftShader gives Mapbox the WebGL
        // context it needs.
        launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
      },
    }] : []),
  ],
  webServer: [
    demoServer(3100, ".next-e2e", ""),
    ...(mapToken ? [demoServer(3101, ".next-e2e-map", mapToken)] : []),
  ],
});
