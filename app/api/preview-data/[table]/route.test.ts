import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function get(table = "trips") {
  return GET(new Request(`https://preview.example.test/api/preview-data/${table}?select=*&slug=eq.lofoten-2026`, {
    headers: { authorization: "Bearer member-token", accept: "application/vnd.pgrst.object+json" },
  }), { params: Promise.resolve({ table }) });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/preview-data/[table]", () => {
  it("forwards preview reads with the member token and preserves the Data API response", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test/neondb/rest/v1");
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"trip-1"}', {
      status: 200,
      headers: { "content-type": "application/json", "content-range": "0-0/*" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "trip-1" });
    expect(response.headers.get("content-range")).toBe("0-0/*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://data.example.test/neondb/rest/v1/trips?select=*&slug=eq.lofoten-2026");
    expect((options.headers as Headers).get("authorization")).toBe("Bearer member-token");
    expect((options.headers as Headers).get("accept")).toBe("application/vnd.pgrst.object+json");
    expect(options.cache).toBe("no-store");
    expect(options.redirect).toBe("manual");
  });

  it("does not expose the proxy outside previews or for other paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test/neondb/rest/v1");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "");

    expect((await get()).status).toBe(404);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await get("private_table")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
