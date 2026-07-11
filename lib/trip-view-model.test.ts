import { describe, expect, it } from "vitest";
import { demoDays, demoTripData } from "./demo-trip";
import { deriveDayStats, deriveOutlierOverlay, filterTripItemsByDay, resolveEditTarget } from "./trip-view-model";
import type { PhotoOutlier } from "./photo-outliers";

describe("filterTripItemsByDay", () => {
  it("keeps every map item when All days is selected", () => {
    const result = filterTripItemsByDay(demoTripData, null);
    expect(result.routes).toHaveLength(demoTripData.routeSegments.length);
    expect(result.photos).toHaveLength(demoTripData.photos.length);
    expect(result.notes).toHaveLength(demoTripData.notes.length);
    expect(result.places).toHaveLength(demoTripData.places.length);
  });

  it("keeps only items assigned to the selected day", () => {
    const result = filterTripItemsByDay(demoTripData, demoDays[1].id);
    expect(result.routes.map((item) => item.id)).toEqual(["route-demo"]);
    expect(result.photos.map((item) => item.id)).toEqual(["photo-demo-2"]);
    expect(result.notes).toEqual([]);
    expect(result.places).toEqual([]);
  });

  it("returns empty collections for an unknown day", () => {
    expect(filterTripItemsByDay(demoTripData, "missing")).toEqual({ routes: [], photos: [], notes: [], places: [] });
  });
});

describe("deriveDayStats", () => {
  it("combines media, journal pins, and route distance by day", () => {
    const stats = deriveDayStats(demoTripData);
    expect(stats.get(demoDays[0].id)).toEqual({ media: 1, journal: 1, distanceMeters: 0 });
    expect(stats.get(demoDays[1].id)).toEqual({ media: 1, journal: 0, distanceMeters: 6200 });
    expect(stats.get(demoDays[2].id)).toEqual({ media: 1, journal: 1, distanceMeters: 0 });
  });

  it("ignores unassigned items and treats missing route distance as zero", () => {
    const data = {
      ...demoTripData,
      photos: [{ ...demoTripData.photos[0], id: "unassigned", day_id: null }],
      notes: [],
      places: [],
      routeSegments: [{ ...demoTripData.routeSegments[0], distance_meters: null }],
    };
    const stats = deriveDayStats(data);
    expect(stats.has("null")).toBe(false);
    expect(stats.get(demoDays[1].id)).toEqual({ media: 0, journal: 0, distanceMeters: 0 });
  });
});

describe("resolveEditTarget", () => {
  it.each([
    ["photo", "photo-demo-1"],
    ["note", "note-demo-1"],
    ["place", "place-demo-1"],
    ["route", "route-demo"],
  ] as const)("resolves a live %s target", (kind, id) => {
    const target = resolveEditTarget(demoTripData, { kind, id });
    expect(target?.kind).toBe(kind);
    expect(target?.item.id).toBe(id);
  });

  it("returns null for no target or an item removed from live data", () => {
    expect(resolveEditTarget(demoTripData, null)).toBeNull();
    expect(resolveEditTarget(demoTripData, { kind: "photo", id: "deleted" })).toBeNull();
  });
});

describe("deriveOutlierOverlay", () => {
  const outlier: PhotoOutlier = {
    photo: demoTripData.photos[0],
    distanceKm: 3,
    suggested: { lng: 13.1, lat: 67.9 },
    neighbors: [{ lng: 13.11, lat: 67.91 }],
    neighborCount: 1,
    windowMinutes: 20,
  };

  it("returns only the coordinates the map overlay needs", () => {
    expect(deriveOutlierOverlay(outlier)).toEqual({
      photo: { lng: demoTripData.photos[0].lng, lat: demoTripData.photos[0].lat },
      suggested: outlier.suggested,
      neighbors: outlier.neighbors,
    });
  });

  it("rejects absent or unlocated outliers", () => {
    expect(deriveOutlierOverlay(null)).toBeNull();
    expect(deriveOutlierOverlay({ ...outlier, photo: { ...outlier.photo, lng: null } })).toBeNull();
    expect(deriveOutlierOverlay({ ...outlier, photo: { ...outlier.photo, lat: null } })).toBeNull();
  });
});
