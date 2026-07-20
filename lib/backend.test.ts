import { afterEach, describe, expect, it, vi } from "vitest";

async function loadBackend() {
  vi.resetModules();
  return import("./backend");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBackendBrowserClient", () => {
  it("stays disabled when either public Neon endpoint is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_NEON_AUTH_URL", "");
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "");
    const { getBackendBrowserClient } = await loadBackend();
    expect(getBackendBrowserClient()).toBeNull();
  });

  it("creates one Neon browser client for explicit auth and data URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_NEON_AUTH_URL", "https://auth.example.test");
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test/rest/v1");
    const { getBackendBrowserClient } = await loadBackend();
    const first = getBackendBrowserClient();
    expect(first).not.toBeNull();
    expect(getBackendBrowserClient()).toBe(first);
  });

  it("preserves local demo mode without constructing a remote client", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_DEMO_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_NEON_AUTH_URL", "https://auth.example.test");
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test/rest/v1");
    const { getBackendBrowserClient } = await loadBackend();
    expect(getBackendBrowserClient()).toBeNull();
  });
});
