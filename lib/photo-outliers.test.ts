import { describe, expect, it } from "vitest";
import { detectPhotoOutliers } from "./photo-outliers";
import type { Photo } from "@/types/trip";

let counter = 0;

function photo(lat: number, lng: number, takenAt: string | null, overrides: Partial<Photo> = {}): Photo {
  counter += 1;
  return {
    id: `photo-${counter}`,
    trip_id: "trip-1",
    day_id: "day-1",
    user_id: null,
    uploader_name: "Ned",
    content_hash: null,
    media_type: "photo",
    image_path: "x.jpg",
    thumbnail_path: null,
    image_url: null,
    thumbnail_url: null,
    lat,
    lng,
    taken_at: takenAt,
    caption: null,
    exif_found: true,
    created_at: takenAt ?? "2026-05-29T10:00:00Z",
    ...overrides,
  };
}

// A tight cluster at the beach within a few minutes. ~0.001° ≈ 60-110m.
function beachCluster() {
  return [
    photo(67.9, 13.0, "2026-05-29T10:00:00Z"),
    photo(67.9005, 13.0004, "2026-05-29T10:03:00Z"),
    photo(67.8998, 12.9996, "2026-05-29T10:06:00Z"),
    photo(67.9002, 13.0008, "2026-05-29T10:09:00Z"),
  ];
}

describe("detectPhotoOutliers", () => {
  it("finds nothing when all photos agree", () => {
    expect(detectPhotoOutliers(beachCluster())).toEqual([]);
  });

  it("flags a photo far from its time-neighbors and suggests their center", () => {
    const stray = photo(67.95, 13.12, "2026-05-29T10:05:00Z"); // ~7km off
    const outliers = detectPhotoOutliers([...beachCluster(), stray]);
    expect(outliers).toHaveLength(1);
    expect(outliers[0].photo.id).toBe(stray.id);
    expect(outliers[0].distanceKm).toBeGreaterThan(4);
    expect(outliers[0].suggested.lat).toBeCloseTo(67.9, 2);
    expect(outliers[0].suggested.lng).toBeCloseTo(13.0, 2);
    expect(outliers[0].neighborCount).toBe(4);
  });

  it("stays robust when two photos are misplaced together", () => {
    const strayA = photo(67.95, 13.12, "2026-05-29T10:05:00Z");
    const strayB = photo(67.951, 13.121, "2026-05-29T10:07:00Z");
    const outliers = detectPhotoOutliers([...beachCluster(), strayA, strayB]);
    // The median center stays at the beach, so both strays flag.
    expect(outliers.map((entry) => entry.photo.id).sort()).toEqual([strayA.id, strayB.id].sort());
  });

  it("tolerates spread-out photos taken while moving", () => {
    // A hike: photos every 5 minutes, each ~700m apart along a line.
    const hike = Array.from({ length: 6 }, (_, index) =>
      photo(67.9 + index * 0.0065, 13.0, `2026-05-29T10:${String(index * 5).padStart(2, "0")}:00Z`),
    );
    expect(detectPhotoOutliers(hike)).toEqual([]);
  });

  it("requires enough neighbors to form a consensus", () => {
    const sparse = [
      photo(67.9, 13.0, "2026-05-29T10:00:00Z"),
      photo(67.95, 13.12, "2026-05-29T10:05:00Z"), // far, but only 1 neighbor
    ];
    expect(detectPhotoOutliers(sparse)).toEqual([]);
  });

  it("ignores photos without time or location", () => {
    const cluster = beachCluster();
    const noTime = photo(67.95, 13.12, null);
    const noCoord = photo(null as unknown as number, null as unknown as number, "2026-05-29T10:05:00Z", { lat: null, lng: null });
    expect(detectPhotoOutliers([...cluster, noTime, noCoord])).toEqual([]);
  });

  it("only compares within the time window", () => {
    const cluster = beachCluster();
    // Same stray position, but hours later: no neighbors in window, no flag.
    const lateStray = photo(67.95, 13.12, "2026-05-29T16:00:00Z");
    expect(detectPhotoOutliers([...cluster, lateStray])).toEqual([]);
  });

  it("sorts the worst offender first", () => {
    const near = photo(67.92, 13.02, "2026-05-29T10:04:00Z"); // ~2.4km
    const far = photo(67.99, 13.2, "2026-05-29T10:05:00Z"); // ~13km
    const outliers = detectPhotoOutliers([...beachCluster(), near, far]);
    expect(outliers.length).toBeGreaterThanOrEqual(2);
    expect(outliers[0].photo.id).toBe(far.id);
  });
});
