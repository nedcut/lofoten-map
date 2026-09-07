import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { objectKey, parseNamespace, validObjectPath } = await import("@/lib/object-store-server");

describe("validObjectPath", () => {
  it.each([
    ["empty string", ""],
    ["leading slash", "/slug/abc.jpg"],
    ["backslash", "slug\\abc.jpg"],
    ["null byte", "slug/abc\0.jpg"],
    ["dot segment", "slug/./abc.jpg"],
    ["dot-dot segment", "slug/../abc.jpg"],
    ["empty segment", "slug//abc.jpg"],
    ["trailing slash", "slug/abc.jpg/"],
    ["over 1024 chars", `slug/${"a".repeat(1024)}`],
  ])("rejects %s", (_label, path) => {
    expect(validObjectPath(path)).toBe(false);
  });

  it("rejects non-string values", () => {
    for (const value of [undefined, null, 42, {}, ["slug/abc.jpg"]]) {
      expect(validObjectPath(value)).toBe(false);
    }
  });

  it("accepts flat and nested paths", () => {
    expect(validObjectPath("slug/abc.jpg")).toBe(true);
    expect(validObjectPath("slug/thumbs/abc.jpg")).toBe(true);
    expect(validObjectPath(`slug/${"a".repeat(1019)}`)).toBe(true);
  });
});

describe("parseNamespace", () => {
  it("returns the known namespaces", () => {
    expect(parseNamespace("trip-photos")).toBe("trip-photos");
    expect(parseNamespace("avatars")).toBe("avatars");
  });

  it("returns null for anything else", () => {
    for (const value of ["", "photos", "trip-photos/", "TRIP-PHOTOS", undefined, null, 1, {}]) {
      expect(parseNamespace(value)).toBeNull();
    }
  });
});

describe("objectKey", () => {
  it("joins namespace and path with a single slash", () => {
    expect(objectKey("trip-photos", "slug/abc.jpg")).toBe("trip-photos/slug/abc.jpg");
    expect(objectKey("avatars", "user/thumbs/a.webp")).toBe("avatars/user/thumbs/a.webp");
  });
});
