import { describe, expect, it } from "vitest";
import { gpxTimeToTripDate, groupPointsByDay, type GpxTrackPoint } from "./gpx";

function point(time: string | null): GpxTrackPoint {
  return { lat: 67.9, lng: 13.0, ele: null, time };
}

describe("gpxTimeToTripDate", () => {
  it("uses the Lofoten/Oslo local date instead of the raw UTC date", () => {
    expect(gpxTimeToTripDate("2026-05-28T22:30:00Z")).toBe("2026-05-29");
  });

  it("returns null for missing or invalid times", () => {
    expect(gpxTimeToTripDate(null)).toBeNull();
    expect(gpxTimeToTripDate("not-a-date")).toBeNull();
  });
});

describe("groupPointsByDay", () => {
  it("groups points by trip-local calendar day while preserving order", () => {
    const may28Morning = point("2026-05-28T08:00:00Z");
    const may28LateLocal = point("2026-05-28T21:30:00Z");
    const may29EarlyLocal = point("2026-05-28T22:30:00Z");
    const may29Morning = point("2026-05-29T08:00:00Z");

    expect(groupPointsByDay([may28Morning, may28LateLocal, may29EarlyLocal, may29Morning])).toEqual([
      [may28Morning, may28LateLocal],
      [may29EarlyLocal, may29Morning],
    ]);
  });

  it("keeps untimed points with the previous timed bucket", () => {
    const first = point("2026-05-28T08:00:00Z");
    const untimed = point(null);
    const nextDay = point("2026-05-29T08:00:00Z");

    expect(groupPointsByDay([first, untimed, nextDay])).toEqual([[first, untimed], [nextDay]]);
  });

  it("preserves leading untimed points in a fallback bucket", () => {
    const untimed = point(null);
    const timed = point("2026-05-28T08:00:00Z");

    expect(groupPointsByDay([untimed, timed])).toEqual([[untimed], [timed]]);
  });
});
