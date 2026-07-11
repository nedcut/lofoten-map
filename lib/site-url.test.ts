import { describe, expect, it } from "vitest";
import { siteUrl } from "./site-url";

describe("siteUrl", () => {
  it("prefers the explicitly configured public origin", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://trips.example.com" }).origin).toBe("https://trips.example.com");
  });

  it("normalizes Vercel hostnames", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "lofoten.example.vercel.app" }).origin).toBe("https://lofoten.example.vercel.app");
  });

  it("never falls back to localhost for a production social card", () => {
    expect(siteUrl({}).origin).toBe("https://lofoten-map-kappa.vercel.app");
  });
});
