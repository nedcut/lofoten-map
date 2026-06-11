import { describe, expect, it } from "vitest";
import { lineDistanceMeters, routeDistanceMeters, routeGeometry } from "./geo";

describe("routeGeometry", () => {
  it("builds a LineString in [lng, lat] order", () => {
    expect(routeGeometry([{ lng: 13.0, lat: 67.9 }, { lng: 13.1, lat: 67.95 }])).toEqual({
      type: "LineString",
      coordinates: [[13.0, 67.9], [13.1, 67.95]],
    });
  });
});

describe("routeDistanceMeters", () => {
  it("returns 0 for fewer than two points", () => {
    expect(routeDistanceMeters([])).toBe(0);
    expect(routeDistanceMeters([{ lng: 13.0, lat: 67.9 }])).toBe(0);
  });

  it("measures roughly 1 km for a 0.009-degree latitude hop", () => {
    const meters = routeDistanceMeters([{ lng: 13.0, lat: 67.9 }, { lng: 13.0, lat: 67.909 }]);
    expect(meters).toBeGreaterThan(950);
    expect(meters).toBeLessThan(1050);
  });
});

describe("lineDistanceMeters", () => {
  it("returns 0 for a degenerate line", () => {
    expect(lineDistanceMeters({ type: "LineString", coordinates: [[13.0, 67.9]] })).toBe(0);
  });

  it("matches routeDistanceMeters for the same points", () => {
    const points = [{ lng: 13.0, lat: 67.9 }, { lng: 13.05, lat: 67.92 }, { lng: 13.1, lat: 67.95 }];
    expect(lineDistanceMeters(routeGeometry(points))).toBe(routeDistanceMeters(points));
  });
});
