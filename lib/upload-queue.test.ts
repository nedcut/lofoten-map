import { describe, expect, it } from "vitest";
import { coordinateAlongRoute, findDayIdForCoordinate, findDayIdForExifDate, formatBytes, nextPlacementTarget, routePlaceQueueItems, type QueueItem } from "./upload-queue";
import type { ExtractedExif } from "./exif";
import type { Day, RouteSegment } from "@/types/trip";

const day1: Day = { id: "day-1", trip_id: "t", day_number: 1, date: "2026-07-12", title: "Reine", summary: null, created_at: "2026-01-01T00:00:00Z" };
const day2: Day = { id: "day-2", trip_id: "t", day_number: 2, date: "2026-07-13", title: "Hike", summary: null, created_at: "2026-01-01T00:00:00Z" };

// A ~2km straight south-to-north line at lng 13.0, assigned to day 1.
const route: RouteSegment = {
  id: "r1",
  trip_id: "t",
  day_id: "day-1",
  name: "test route",
  source: "seed",
  mode: "hike",
  geometry_geojson: { type: "LineString", coordinates: [[13.0, 67.9], [13.0, 67.918]] },
  distance_meters: 2000,
  elevation_gain_meters: null,
  created_at: "2026-01-01T00:00:00Z",
};

function exif(overrides: Partial<ExtractedExif> = {}): ExtractedExif {
  return { lat: null, lng: null, takenAt: null, takenDate: null, exifFound: false, message: "", ...overrides };
}

function queueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "q-1",
    file: new File([], "a.jpg", { type: "image/jpeg" }),
    mediaType: "photo",
    contentHash: "hash",
    caption: "",
    dayId: "day-1",
    dayMatchSource: "date",
    locationSource: null,
    exif: exif(),
    coordinate: null,
    status: "needs-location",
    message: "",
    ...overrides,
  };
}

describe("findDayIdForExifDate", () => {
  it("matches takenDate against the day's calendar date", () => {
    expect(findDayIdForExifDate([day1, day2], exif({ takenDate: "2026-07-13" }))).toBe("day-2");
  });

  it("falls back to the date prefix of takenAt", () => {
    expect(findDayIdForExifDate([day1, day2], exif({ takenAt: "2026-07-12T18:00:00Z" }))).toBe("day-1");
  });

  it("returns null without a usable date", () => {
    expect(findDayIdForExifDate([day1, day2], exif())).toBeNull();
  });
});

describe("findDayIdForCoordinate", () => {
  it("matches a photo within 500m of a day's route", () => {
    expect(findDayIdForCoordinate([route], { lng: 13.002, lat: 67.91 })).toBe("day-1");
  });

  it("rejects a photo far from every route", () => {
    expect(findDayIdForCoordinate([route], { lng: 13.2, lat: 67.91 })).toBeNull();
  });

  it("returns null without a coordinate", () => {
    expect(findDayIdForCoordinate([route], null)).toBeNull();
  });
});

describe("routePlaceQueueItems", () => {
  it("places a lone GPS-less photo at the route midpoint", () => {
    const [placed] = routePlaceQueueItems([queueItem()], [route]);
    expect(placed.status).toBe("ready");
    expect(placed.locationSource).toBe("route");
    expect(placed.coordinate!.lat).toBeCloseTo(67.909, 2);
  });

  it("spaces multiple photos along the route ordered by taken time", () => {
    const earlier = queueItem({ id: "q-early", exif: exif({ takenAt: "2026-07-12T09:00:00Z" }) });
    const later = queueItem({ id: "q-late", exif: exif({ takenAt: "2026-07-12T17:00:00Z" }) });
    // Pass them out of order; placement must sort by time, so the earlier
    // photo lands further south (lower latitude) on the northbound line.
    const placed = routePlaceQueueItems([later, earlier], [route]);
    const byId = new Map(placed.map((item) => [item.id, item]));
    expect(byId.get("q-early")!.coordinate!.lat).toBeLessThan(byId.get("q-late")!.coordinate!.lat);
  });

  it("leaves photos alone when their day has no route", () => {
    const [unplaced] = routePlaceQueueItems([queueItem({ dayId: "day-2" })], [route]);
    expect(unplaced.status).toBe("needs-location");
    expect(unplaced.coordinate).toBeNull();
  });

  it("never moves a photo that already has a coordinate", () => {
    const located = queueItem({ coordinate: { lng: 13.05, lat: 67.95 }, locationSource: "gps", status: "ready" });
    const [kept] = routePlaceQueueItems([located], [route]);
    expect(kept.coordinate).toEqual({ lng: 13.05, lat: 67.95 });
    expect(kept.locationSource).toBe("gps");
  });
});

describe("coordinateAlongRoute", () => {
  it("clamps the fraction away from the endpoints", () => {
    const nearStart = coordinateAlongRoute(route, 0)!;
    const nearEnd = coordinateAlongRoute(route, 1)!;
    expect(nearStart.lat).toBeGreaterThan(67.9);
    expect(nearEnd.lat).toBeLessThan(67.918);
  });
});

describe("nextPlacementTarget", () => {
  it("walks to the unplaced photo taken right after the placed group", () => {
    const placedA = queueItem({ id: "a", status: "ready", exif: exif({ takenAt: "2026-07-12T10:00:00Z" }) });
    const placedB = queueItem({ id: "b", status: "ready", exif: exif({ takenAt: "2026-07-12T10:10:00Z" }) });
    const earlier = queueItem({ id: "earlier", exif: exif({ takenAt: "2026-07-12T08:00:00Z" }) });
    const next = queueItem({ id: "next", exif: exif({ takenAt: "2026-07-12T11:00:00Z" }) });
    expect(nextPlacementTarget([next, earlier, placedA, placedB], new Set(["a", "b"]))).toBe("next");
  });

  it("wraps to the earliest remaining photo when nothing comes later", () => {
    const placed = queueItem({ id: "placed", status: "ready", exif: exif({ takenAt: "2026-07-12T20:00:00Z" }) });
    const morning = queueItem({ id: "morning", exif: exif({ takenAt: "2026-07-12T08:00:00Z" }) });
    const noon = queueItem({ id: "noon", exif: exif({ takenAt: "2026-07-12T12:00:00Z" }) });
    expect(nextPlacementTarget([noon, morning, placed], new Set(["placed"]))).toBe("morning");
  });

  it("sorts undated photos after dated ones, in queue order", () => {
    const undatedFirst = queueItem({ id: "undated-1", exif: exif() });
    const undatedSecond = queueItem({ id: "undated-2", exif: exif() });
    const dated = queueItem({ id: "dated", exif: exif({ takenAt: "2026-07-12T09:00:00Z" }) });
    expect(nextPlacementTarget([undatedFirst, undatedSecond, dated], new Set())).toBe("dated");
    expect(nextPlacementTarget([undatedFirst, undatedSecond], new Set())).toBe("undated-1");
  });

  it("returns null when every photo is placed", () => {
    const placed = queueItem({ id: "placed", status: "ready" });
    expect(nextPlacementTarget([placed], new Set(["placed"]))).toBeNull();
  });
});

describe("formatBytes", () => {
  it("formats KB and MB", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
