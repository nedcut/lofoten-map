import { afterEach, describe, expect, it, vi } from "vitest";
import { backendPreviewWriteBlock, isPreviewReadOnly } from "./preview-read-only";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPreviewReadOnly", () => {
  it("is off in local and production environments", () => {
    // Clear both so a shell that already has VERCEL_ENV=preview can't leak in.
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "");
    expect(isPreviewReadOnly()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "production");
    expect(isPreviewReadOnly()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "development");
    expect(isPreviewReadOnly()).toBe(false);
  });

  it("turns on for Vercel preview builds", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isPreviewReadOnly()).toBe(true);
  });

  it("turns on from the public Vercel env inlined into the browser bundle", () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    expect(isPreviewReadOnly()).toBe(true);
  });
});

describe("backendPreviewWriteBlock", () => {
  it("does not block demo mode even on a Vercel preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(backendPreviewWriteBlock(false)).toBeNull();
  });

  it("blocks shared-backend writes on a Vercel preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(backendPreviewWriteBlock(true)).toBe(
      "This preview is view-only. Open the live app to add or edit trip data.",
    );
  });
});
