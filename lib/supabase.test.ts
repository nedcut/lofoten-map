import { describe, it, expect } from "vitest";
import { applySignedPhotoUrls } from "./supabase";
import type { Photo } from "@/types/trip";

function photo(overrides: Partial<Photo>): Photo {
  return {
    id: "p1",
    trip_id: "t1",
    day_id: null,
    user_id: null,
    uploader_name: "Friend",
    image_path: "lofoten-2026/a.jpg",
    thumbnail_path: "lofoten-2026/thumbs/a.jpg",
    image_url: null,
    thumbnail_url: null,
    lat: null,
    lng: null,
    taken_at: null,
    caption: null,
    exif_found: false,
    created_at: "2026-06-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("applySignedPhotoUrls", () => {
  it("resolves image and thumbnail URLs from the lookup", () => {
    const map = new Map([
      ["lofoten-2026/a.jpg", "https://signed/a?token=1"],
      ["lofoten-2026/thumbs/a.jpg", "https://signed/a-thumb?token=2"],
    ]);
    const [result] = applySignedPhotoUrls([photo({})], map);
    expect(result.image_url).toBe("https://signed/a?token=1");
    expect(result.thumbnail_url).toBe("https://signed/a-thumb?token=2");
  });

  it("leaves a URL null when its path is absent from the lookup", () => {
    const map = new Map([["lofoten-2026/a.jpg", "https://signed/a?token=1"]]);
    const [result] = applySignedPhotoUrls([photo({})], map);
    expect(result.image_url).toBe("https://signed/a?token=1");
    expect(result.thumbnail_url).toBeNull(); // thumb path not signed
  });

  it("keeps thumbnail_url null when the photo has no thumbnail_path", () => {
    const map = new Map([["lofoten-2026/a.jpg", "https://signed/a?token=1"]]);
    const [result] = applySignedPhotoUrls([photo({ thumbnail_path: null })], map);
    expect(result.thumbnail_url).toBeNull();
  });

  it("returns null URLs for an empty lookup", () => {
    const [result] = applySignedPhotoUrls([photo({})], new Map());
    expect(result.image_url).toBeNull();
    expect(result.thumbnail_url).toBeNull();
  });

  it("preserves all non-URL fields and does not mutate the input", () => {
    const input = photo({ caption: "Reine at dawn", lat: 67.9, lng: 13.1 });
    const snapshot = { ...input };
    const [result] = applySignedPhotoUrls([input], new Map([["lofoten-2026/a.jpg", "https://signed/a"]]));
    expect(result.caption).toBe("Reine at dawn");
    expect(result.lat).toBe(67.9);
    expect(result.image_path).toBe("lofoten-2026/a.jpg");
    // input object is untouched (new object returned)
    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });
});
