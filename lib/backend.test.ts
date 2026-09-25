import { afterEach, describe, expect, it, vi } from "vitest";

async function loadBackend() {
  vi.resetModules();
  return import("./backend");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("./backend-client");
});

describe("loadBackendBrowserClient", () => {
  it("stays disabled when either public Neon endpoint is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_NEON_AUTH_URL", "");
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "");
    const { isBackendConfigured, loadBackendBrowserClient } = await loadBackend();
    expect(isBackendConfigured()).toBe(false);
    await expect(loadBackendBrowserClient()).resolves.toBeNull();
  });

  it("creates one Neon browser client for explicit auth and data URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_NEON_AUTH_URL", "https://auth.example.test");
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test/rest/v1");
    const { isBackendConfigured, loadBackendBrowserClient } = await loadBackend();
    expect(isBackendConfigured()).toBe(true);
    const first = await loadBackendBrowserClient();
    expect(first).not.toBeNull();
    await expect(loadBackendBrowserClient()).resolves.toBe(first);
  });

  it("preserves local demo mode without constructing a remote client", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_DEMO_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_NEON_AUTH_URL", "https://auth.example.test");
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test/rest/v1");
    const { isBackendConfigured, loadBackendBrowserClient } = await loadBackend();
    expect(isBackendConfigured()).toBe(false);
    await expect(loadBackendBrowserClient()).resolves.toBeNull();
  });

  it("retries the SDK import after a failed load", async () => {
    vi.stubEnv("NEXT_PUBLIC_NEON_AUTH_URL", "https://auth.example.test");
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test/rest/v1");
    const client = { auth: {} };
    const createNeonBrowserClient = vi.fn()
      .mockImplementationOnce(() => { throw new Error("chunk failed"); })
      .mockReturnValue(client);
    vi.doMock("./backend-client", () => ({ createNeonBrowserClient }));
    const { loadBackendBrowserClient } = await loadBackend();
    await expect(loadBackendBrowserClient()).rejects.toThrow("chunk failed");
    await expect(loadBackendBrowserClient()).resolves.toBe(client);
  });
});
