import { describe, expect, it } from "vitest";
import { plainDataEqual, reuseIfEqual } from "./trip-data-equal";
import { demoTripData } from "./demo-trip";

describe("plainDataEqual", () => {
  it("treats structurally identical nested data as equal", () => {
    const a = { rows: [{ id: "1", geo: { lat: 1, lng: [2, 3] }, note: null }] };
    const b = { rows: [{ id: "1", geo: { lat: 1, lng: [2, 3] }, note: null }] };
    expect(plainDataEqual(a, b)).toBe(true);
  });

  it("ignores key order", () => {
    expect(plainDataEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("detects changed, added, and missing values", () => {
    expect(plainDataEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(plainDataEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(plainDataEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(plainDataEqual([{ id: "1" }], [{ id: "2" }])).toBe(false);
  });

  it("distinguishes arrays from objects and null from objects", () => {
    expect(plainDataEqual([], {})).toBe(false);
    expect(plainDataEqual(null, {})).toBe(false);
    expect(plainDataEqual(undefined, null)).toBe(false);
  });

  it("treats NaN as equal to NaN", () => {
    expect(plainDataEqual({ v: Number.NaN }, { v: Number.NaN })).toBe(true);
  });
});

describe("reuseIfEqual", () => {
  it("returns the previous object when the refresh carries the same content", () => {
    const previous = structuredClone(demoTripData);
    const next = structuredClone(demoTripData);
    expect(next).not.toBe(previous);
    expect(reuseIfEqual(previous, next)).toBe(previous);
  });

  it("updates changed collections while preserving unchanged collection identities", () => {
    const previous = structuredClone(demoTripData);
    const next = structuredClone(demoTripData);
    next.photos[0] = { ...next.photos[0], caption: "changed" };
    const result = reuseIfEqual(previous, next);
    expect(result).toEqual(next);
    expect(result).not.toBe(previous);
    expect(result.photos).toBe(next.photos);
    for (const key of ["trip", "days", "routeSegments", "notes", "places", "members", "adminRequests"] as const) {
      expect(result[key]).toBe(previous[key]);
    }
    expect(previous.photos[0].caption).not.toBe("changed");
  });
});
