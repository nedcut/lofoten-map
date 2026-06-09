import { describe, expect, it } from "vitest";
import { partitionDuplicatePhotos, photoMetadataKey } from "./photo-dedup";
import type { Photo } from "@/types/trip";

function photo(overrides: Partial<Photo>): Photo {
  return {
    id: "photo-1",
    trip_id: "trip-1",
    day_id: null,
    user_id: null,
    uploader_name: "Friend",
    content_hash: null,
    image_path: "trip/one.jpg",
    thumbnail_path: null,
    image_url: null,
    thumbnail_url: null,
    lat: 67.9,
    lng: 13.08,
    taken_at: "2026-06-09T12:00:00+00:00",
    caption: null,
    exif_found: true,
    created_at: "2026-06-09T13:00:00.000Z",
    ...overrides,
  };
}

function candidate(overrides: Partial<{ contentHash: string; takenAt: string | null; coordinate: { lat: number; lng: number } }>) {
  return {
    contentHash: "hash-a",
    takenAt: "2026-06-09T12:00:00+00:00",
    coordinate: { lat: 67.9, lng: 13.08 },
    ...overrides,
  };
}

describe("photoMetadataKey", () => {
  it("is null without a capture time or coordinates", () => {
    expect(photoMetadataKey(null, 67.9, 13.08)).toBeNull();
    expect(photoMetadataKey("2026-06-09T12:00:00+00:00", null, 13.08)).toBeNull();
    expect(photoMetadataKey("not a date", 67.9, 13.08)).toBeNull();
  });

  it("matches the same instant across timezone spellings", () => {
    expect(photoMetadataKey("2026-06-09T12:00:00+00:00", 67.9, 13.08))
      .toBe(photoMetadataKey("2026-06-09T14:00:00+02:00", 67.9, 13.08));
  });

  it("separates photos taken at the same spot at different times", () => {
    expect(photoMetadataKey("2026-06-09T12:00:00+00:00", 67.9, 13.08))
      .not.toBe(photoMetadataKey("2026-06-09T12:00:01+00:00", 67.9, 13.08));
  });
});

describe("partitionDuplicatePhotos", () => {
  it("skips a candidate whose hash matches an existing photo", () => {
    const { uploads, duplicates } = partitionDuplicatePhotos(
      [candidate({ contentHash: "hash-a" })],
      [photo({ content_hash: "hash-a" })],
    );
    expect(uploads).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
  });

  it("skips a candidate whose capture time and GPS match an existing photo even when hashes differ", () => {
    const { uploads, duplicates } = partitionDuplicatePhotos(
      [candidate({ contentHash: "hash-of-original-bytes" })],
      [photo({ content_hash: "hash-of-stored-reencoded-bytes" })],
    );
    expect(uploads).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
  });

  it("dedupes within the batch itself", () => {
    const { uploads, duplicates } = partitionDuplicatePhotos(
      [candidate({ contentHash: "hash-a" }), candidate({ contentHash: "hash-a" })],
      [],
    );
    expect(uploads).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it("lets distinct photos through, including hand-placed ones without capture metadata", () => {
    const { uploads, duplicates } = partitionDuplicatePhotos(
      [
        candidate({ contentHash: "hash-a", takenAt: null }),
        candidate({ contentHash: "hash-b", takenAt: null, coordinate: { lat: 67.9, lng: 13.08 } }),
        candidate({ contentHash: "hash-c", takenAt: "2026-06-09T15:00:00+00:00" }),
      ],
      [photo({ content_hash: "hash-z" })],
    );
    expect(uploads).toHaveLength(3);
    expect(duplicates).toHaveLength(0);
  });
});
