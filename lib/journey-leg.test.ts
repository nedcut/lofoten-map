import { describe, expect, it } from "vitest";
import type { Position } from "geojson";
import { bearingAlongLeg, distanceKm, legBetween, lerpBearing, offsetPoint, pointAlongLeg, steerBearing } from "./journey-leg";
import type { RouteSegment } from "@/types/trip";

function route(coordinates: Position[], overrides: Partial<RouteSegment> = {}): RouteSegment {
  return {
    id: "route-1",
    trip_id: "trip-1",
    day_id: "day-1",
    name: "Test route",
    source: "gpx",
    mode: "hike",
    geometry_geojson: { type: "LineString", coordinates },
    distance_meters: null,
    elevation_gain_meters: null,
    created_at: "2026-05-27T00:00:00Z",
    ...overrides,
  };
}

// A gently bent trail heading roughly north; ~0.001° latitude is ~111m.
const trail = route([
  [13.0, 67.9],
  [13.001, 67.905],
  [13.004, 67.91],
  [13.002, 67.915],
  [13.0, 67.92],
]);

describe("legBetween", () => {
  it("returns null without both endpoints", () => {
    expect(legBetween(null, { lng: 13, lat: 67.9 }, [trail])).toBeNull();
    expect(legBetween({ lng: 13, lat: 67.9 }, null, [trail])).toBeNull();
  });

  it("returns null when the endpoints are effectively the same place", () => {
    const here = { lng: 13.0, lat: 67.9 };
    expect(legBetween(here, { lng: 13.0, lat: 67.90001 }, [trail])).toBeNull();
  });

  it("follows a route both endpoints snap to", () => {
    const leg = legBetween({ lng: 13.0001, lat: 67.9002 }, { lng: 13.0001, lat: 67.9198 }, [trail]);
    expect(leg).not.toBeNull();
    expect(leg!.onRoute).toBe(true);
    // The path should pass near the trail's eastward bulge at 13.004 rather
    // than cutting straight between the endpoints (which stay near lng 13.0).
    const lngs = leg!.line.geometry.coordinates.map(([lng]) => lng);
    expect(Math.max(...lngs)).toBeGreaterThan(13.003);
    // Starts and ends exactly at the items, not at the snap points.
    expect(leg!.line.geometry.coordinates[0]).toEqual([13.0001, 67.9002]);
    expect(leg!.line.geometry.coordinates.at(-1)).toEqual([13.0001, 67.9198]);
  });

  it("reverses the slice when travelling against the route's drawn direction", () => {
    const leg = legBetween({ lng: 13.0001, lat: 67.9198 }, { lng: 13.0001, lat: 67.9002 }, [trail]);
    expect(leg).not.toBeNull();
    expect(leg!.onRoute).toBe(true);
    const lats = leg!.line.geometry.coordinates.map(([, lat]) => lat);
    // Latitudes should decrease overall: south-bound travel.
    expect(lats[0]).toBeGreaterThan(lats.at(-1)!);
    const interior = lats.slice(1, -1);
    expect(interior[0]).toBeGreaterThan(interior.at(-1)!);
  });

  it("falls back to a straight line when no route is near both endpoints", () => {
    const farAway = { lng: 14.5, lat: 68.4 };
    const leg = legBetween({ lng: 13.0, lat: 67.9 }, farAway, [trail]);
    expect(leg).not.toBeNull();
    expect(leg!.onRoute).toBe(false);
    expect(leg!.line.geometry.coordinates).toHaveLength(2);
  });

  it("prefers the route that snaps closest to both endpoints", () => {
    const offsetTrail = route(
      trail.geometry_geojson.type === "LineString"
        ? trail.geometry_geojson.coordinates.map(([lng, lat]) => [lng + 0.003, lat] as Position)
        : [],
      { id: "route-2" },
    );
    const leg = legBetween({ lng: 13.0001, lat: 67.9002 }, { lng: 13.0001, lat: 67.9198 }, [offsetTrail, trail]);
    expect(leg).not.toBeNull();
    // The nearer trail bulges to 13.004; the offset one would reach 13.007.
    const lngs = leg!.line.geometry.coordinates.map(([lng]) => lng);
    expect(Math.max(...lngs)).toBeLessThan(13.006);
  });
});

describe("pointAlongLeg / bearingAlongLeg", () => {
  const leg = legBetween({ lng: 13.0, lat: 67.9 }, { lng: 13.0, lat: 67.92 }, [])!;

  it("interpolates from start to end and clamps the fraction", () => {
    expect(pointAlongLeg(leg, 0)).toEqual([13.0, 67.9]);
    const [lng, lat] = pointAlongLeg(leg, 1.4);
    expect(lng).toBeCloseTo(13.0, 5);
    expect(lat).toBeCloseTo(67.92, 5);
    const [, midLat] = pointAlongLeg(leg, 0.5);
    expect(midLat).toBeGreaterThan(67.9);
    expect(midLat).toBeLessThan(67.92);
  });

  it("faces the direction of travel, including at the end of the leg", () => {
    expect(bearingAlongLeg(leg, 0)).toBeCloseTo(0, 0);
    expect(bearingAlongLeg(leg, 1)).toBeCloseTo(0, 0);
  });
});

describe("offsetPoint", () => {
  it("projects a point in the given direction", () => {
    const [lng, lat] = offsetPoint([13.0, 67.9], 1, 0); // 1km due north
    expect(lng).toBeCloseTo(13.0, 4);
    expect(lat).toBeCloseTo(67.909, 3);
    const [eastLng, eastLat] = offsetPoint([13.0, 67.9], 1, 90);
    expect(eastLng).toBeGreaterThan(13.0);
    expect(eastLat).toBeCloseTo(67.9, 3);
  });
});

describe("distanceKm", () => {
  it("measures great-circle distance", () => {
    expect(distanceKm({ lng: 13, lat: 67.9 }, { lng: 13, lat: 67.9 })).toBe(0);
    // 0.01° of latitude is ~1.11km
    expect(distanceKm({ lng: 13, lat: 67.9 }, { lng: 13, lat: 67.91 })).toBeCloseTo(1.11, 1);
  });
});

describe("steerBearing", () => {
  it("passes small corrections through unclamped", () => {
    expect(steerBearing(40, 55, 30)).toBeCloseTo(55);
  });

  it("caps large turns at the limit, including reversals", () => {
    expect(steerBearing(0, 170, 30)).toBeCloseTo(30);
    expect(steerBearing(0, -170, 30)).toBeCloseTo(-30);
  });

  it("turns along the shortest arc across north", () => {
    expect(steerBearing(350, 10, 30)).toBeCloseTo(370);
  });
});

describe("lerpBearing", () => {
  it("rotates along the shortest arc across north", () => {
    expect(lerpBearing(350, 10, 0.5)).toBeCloseTo(360);
    expect(lerpBearing(10, 350, 0.5)).toBeCloseTo(0);
  });

  it("interpolates plainly when no wrap is involved", () => {
    expect(lerpBearing(40, 80, 0.25)).toBeCloseTo(50);
  });
});
