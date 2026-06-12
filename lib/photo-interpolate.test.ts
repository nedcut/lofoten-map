import { describe, expect, it } from "vitest";
import { collectTimeAnchors, interpolatedCoordinate, neighborAnchors, timeInterpolateItems, type TimeAnchor } from "./photo-interpolate";
import type { ExtractedExif } from "./exif";
import type { AnalyzedItem } from "./upload-queue";
import type { Photo } from "@/types/trip";

function exif(overrides: Partial<ExtractedExif> = {}): ExtractedExif {
  return { lat: null, lng: null, takenAt: null, takenDate: null, exifFound: false, message: "", ...overrides };
}

function analyzedItem(overrides: Partial<AnalyzedItem> = {}): AnalyzedItem {
  return {
    id: "a-1",
    order: 0,
    dayId: null,
    dayMatchSource: null,
    locationSource: null,
    exif: null,
    coordinate: null,
    status: "needs-location",
    message: "",
    ...overrides,
  };
}

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "p-1",
    trip_id: "t",
    day_id: null,
    user_id: null,
    uploader_name: null,
    content_hash: null,
    media_type: "photo",
    image_path: "photos/p-1.jpg",
    thumbnail_path: null,
    image_url: null,
    thumbnail_url: null,
    lat: null,
    lng: null,
    taken_at: null,
    caption: null,
    exif_found: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const T0 = "2026-07-12T10:00:00Z";
const T1 = "2026-07-12T10:30:00Z";
const T2 = "2026-07-12T11:00:00Z";

describe("collectTimeAnchors", () => {
  it("collects GPS batch items and located trip photos, sorted by time", () => {
    const items = [
      analyzedItem({ id: "later", locationSource: "gps", coordinate: { lat: 68.0, lng: 13.2 }, exif: exif({ takenAt: T2 }), status: "ready" }),
      analyzedItem({ id: "no-gps", exif: exif({ takenAt: T1 }) }),
    ];
    const photos = [photo({ lat: 67.9, lng: 13.0, taken_at: T0 })];
    const anchors = collectTimeAnchors(items, photos);
    expect(anchors.map((anchor) => anchor.timeMs)).toEqual([new Date(T0).getTime(), new Date(T2).getTime()]);
    expect(anchors[0].coordinate).toEqual({ lat: 67.9, lng: 13.0 });
  });

  it("skips anchors without a usable timestamp or position", () => {
    const items = [analyzedItem({ locationSource: "gps", coordinate: { lat: 68.0, lng: 13.2 }, exif: exif({ takenAt: null }), status: "ready" })];
    const photos = [photo({ lat: 67.9, lng: 13.0, taken_at: "not-a-date" }), photo({ lat: null, lng: null, taken_at: T0 })];
    expect(collectTimeAnchors(items, photos)).toEqual([]);
  });
});

describe("neighborAnchors", () => {
  const anchors: TimeAnchor[] = [
    { timeMs: 100, coordinate: { lat: 1, lng: 1 } },
    { timeMs: 200, coordinate: { lat: 2, lng: 2 } },
    { timeMs: 300, coordinate: { lat: 3, lng: 3 } },
  ];

  it("finds the surrounding pair for a time between anchors", () => {
    const { before, after } = neighborAnchors(anchors, 250);
    expect(before?.timeMs).toBe(200);
    expect(after?.timeMs).toBe(300);
  });

  it("returns only an after-anchor before the first, only a before-anchor past the last", () => {
    expect(neighborAnchors(anchors, 50)).toEqual({ before: null, after: anchors[0] });
    expect(neighborAnchors(anchors, 400)).toEqual({ before: anchors[2], after: null });
  });
});

describe("timeInterpolateItems", () => {
  const anchors: TimeAnchor[] = [
    { timeMs: new Date(T0).getTime(), coordinate: { lat: 67.9, lng: 13.0 } },
    { timeMs: new Date(T2).getTime(), coordinate: { lat: 68.0, lng: 13.2 } },
  ];

  it("leaves items untouched when there are no anchors", () => {
    const item = analyzedItem({ exif: exif({ takenAt: T1 }) });
    timeInterpolateItems([item], []);
    expect(item.coordinate).toBeNull();
    expect(item.status).toBe("needs-location");
  });

  it("never touches invalid, reading, already-placed, or timestamp-less items", () => {
    const placed = analyzedItem({ id: "placed", coordinate: { lat: 1, lng: 1 }, locationSource: "gps", status: "ready", exif: exif({ takenAt: T1 }) });
    const invalid = analyzedItem({ id: "invalid", status: "invalid", exif: exif({ takenAt: T1 }) });
    const undated = analyzedItem({ id: "undated", exif: exif() });
    timeInterpolateItems([placed, invalid, undated], anchors);
    expect(placed.locationSource).toBe("gps");
    expect(invalid.status).toBe("invalid");
    expect(undated.coordinate).toBeNull();
  });

  it("places a photo between two close anchors proportionally to time", () => {
    const item = analyzedItem({ exif: exif({ takenAt: T1 }) });
    timeInterpolateItems([item], anchors);
    expect(item.status).toBe("ready");
    expect(item.locationSource).toBe("time");
    expect(item.coordinate?.lat).toBeCloseTo(67.95, 5);
    expect(item.coordinate?.lng).toBeCloseTo(13.1, 5);
  });
});

describe("interpolatedCoordinate", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const reine = { lat: 67.93, lng: 13.09 };
  const hamnoy = { lat: 67.95, lng: 13.15 };

  it("returns null with no anchors at all", () => {
    expect(interpolatedCoordinate(null, null, at(T1))).toBeNull();
  });

  it("lerps proportionally between anchors within the trust window", () => {
    const before = { timeMs: at("2026-07-12T10:00:00Z"), coordinate: reine };
    const after = { timeMs: at("2026-07-12T11:00:00Z"), coordinate: hamnoy };
    const quarter = interpolatedCoordinate(before, after, at("2026-07-12T10:15:00Z"));
    expect(quarter?.lat).toBeCloseTo(67.935, 5);
    expect(quarter?.lng).toBeCloseTo(13.105, 5);
  });

  it("snaps to a lone recent anchor instead of declining", () => {
    const before = { timeMs: at("2026-07-12T10:00:00Z"), coordinate: reine };
    expect(interpolatedCoordinate(before, null, at("2026-07-12T10:05:00Z"))).toEqual(reine);
    expect(interpolatedCoordinate(null, before, at("2026-07-12T09:50:00Z"))).toEqual(reine);
  });

  it("declines a lone anchor that is too old to mean 'same spot'", () => {
    const before = { timeMs: at("2026-07-12T06:00:00Z"), coordinate: reine };
    expect(interpolatedCoordinate(before, null, at("2026-07-12T10:00:00Z"))).toBeNull();
  });

  it("does not lerp across anchors hours apart, but still snaps to a close one", () => {
    const before = { timeMs: at("2026-07-12T08:00:00Z"), coordinate: reine };
    const after = { timeMs: at("2026-07-12T18:00:00Z"), coordinate: hamnoy };
    // Mid-gap, near neither anchor: decline rather than place mid-fjord.
    expect(interpolatedCoordinate(before, after, at("2026-07-12T13:00:00Z"))).toBeNull();
    // Ten minutes after the morning anchor: same spot, snap to it.
    expect(interpolatedCoordinate(before, after, at("2026-07-12T08:10:00Z"))).toEqual(reine);
  });

  it("handles anchors at identical timestamps without dividing by zero", () => {
    const moment = at("2026-07-12T10:00:00Z");
    expect(interpolatedCoordinate({ timeMs: moment, coordinate: reine }, { timeMs: moment, coordinate: hamnoy }, moment)).toEqual(reine);
  });
});
