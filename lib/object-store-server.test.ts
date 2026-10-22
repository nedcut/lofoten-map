import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { authorizeObjectRequest, isContentAddressedPhotoPath, objectKey, parseNamespace, validObjectPath } = await import("@/lib/object-store-server");

const HASH = "a".repeat(64);

describe("isContentAddressedPhotoPath", () => {
  it("accepts the original, thumbnail and marker shapes", () => {
    expect(isContentAddressedPhotoPath(`slug/${HASH}.mov`)).toBe(true);
    expect(isContentAddressedPhotoPath(`slug/thumbs/${HASH}.jpg`)).toBe(true);
    expect(isContentAddressedPhotoPath(`slug/markers/${HASH}.jpg`)).toBe(true);
    expect(isContentAddressedPhotoPath(`slug/markers/${HASH}.png`)).toBe(false);
    expect(isContentAddressedPhotoPath(`slug/other/${HASH}.jpg`)).toBe(false);
  });
});

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

describe("authorizeObjectRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function requestWithToken() {
    return new Request("http://localhost/api/storage/delete", { headers: { authorization: "Bearer t" } });
  }

  it("throws when the delete RPC does not exist in the database", async () => {
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test/");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "PGRST202", message: "Could not find the function public.can_delete_photo_object(check_path, check_trip_slug) in the schema cache" }),
      { status: 404, headers: { "content-type": "application/json" } },
    )));
    await expect(authorizeObjectRequest(requestWithToken(), "trip-photos", "slug/abc.jpg", "delete"))
      .rejects.toThrow(/can_delete_photo_object/);
  });

  // No column stores a marker path, so the row check must look for the
  // thumbnail it derives from; checking the marker path itself would always
  // read as "unreferenced" and let any member delete it.
  it("authorizes a marker delete as its thumbnail", async () => {
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test");
    const fetchMock = vi.fn().mockResolvedValue(new Response("true", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(authorizeObjectRequest(requestWithToken(), "trip-photos", `slug/markers/${HASH}.jpg`, "delete")).resolves.toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ check_trip_slug: "slug", check_path: `slug/thumbs/${HASH}.jpg` });
  });

  it("denies on other RPC failures", async () => {
    vi.stubEnv("NEXT_PUBLIC_NEON_DATA_API_URL", "https://data.example.test");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "42501", message: "permission denied for function can_delete_photo_object" }),
      { status: 401, headers: { "content-type": "application/json" } },
    )));
    await expect(authorizeObjectRequest(requestWithToken(), "trip-photos", "slug/abc.jpg", "delete")).resolves.toBe(false);
  });
});
