import { describe, it, expect } from "vitest";
import { coordinateFromExif, parseExifDate } from "./exif";

describe("coordinateFromExif", () => {
  it("returns a direct decimal coordinate unchanged for N/E refs", () => {
    expect(coordinateFromExif(68.123, "N")).toBeCloseTo(68.123, 6);
    expect(coordinateFromExif(13.456, "E")).toBeCloseTo(13.456, 6);
  });

  it("flips the sign into the southern/western hemisphere", () => {
    expect(coordinateFromExif(33.87, "S")).toBeCloseTo(-33.87, 6);
    expect(coordinateFromExif(118.4, "W")).toBeCloseTo(-118.4, 6);
  });

  it("uses the absolute value before applying a S/W ref", () => {
    // A negative magnitude with a "W" ref should not double-negate back to positive.
    expect(coordinateFromExif(-118.4, "W")).toBeCloseTo(-118.4, 6);
  });

  it("converts degrees/minutes/seconds arrays to decimal degrees", () => {
    // 68° 7' 22.8" N -> 68 + 7/60 + 22.8/3600 = 68.1230
    expect(coordinateFromExif([68, 7, 22.8], "N")).toBeCloseTo(68.123, 3);
  });

  it("converts DMS arrays of rational pairs", () => {
    // 68° 7' 22.8" expressed as [num, den] rationals
    const dms = [
      [68, 1],
      [7, 1],
      [228, 10],
    ];
    expect(coordinateFromExif(dms, "N")).toBeCloseTo(68.123, 3);
  });

  it("reads coordinates from ExifReader tag objects via .value", () => {
    expect(coordinateFromExif({ value: 68.123, description: "68.123" }, { value: "N" })).toBeCloseTo(68.123, 3);
  });

  it("normalizes the ref (whitespace / lower case) before comparing", () => {
    expect(coordinateFromExif(33.87, " s ")).toBeCloseTo(-33.87, 6);
    expect(coordinateFromExif(118.4, "w")).toBeCloseTo(-118.4, 6);
  });

  it("returns null when the value cannot be parsed", () => {
    expect(coordinateFromExif(undefined, "N")).toBeNull();
    expect(coordinateFromExif("not-a-number", "N")).toBeNull();
    expect(coordinateFromExif([68], "N")).toBeNull(); // too few components to parse
  });

  it("treats a 2-element numeric array as a single rational (num/den)", () => {
    // Documents existing behavior: [68, 7] is read as 68/7, not as partial DMS.
    expect(coordinateFromExif([68, 7], "N")).toBeCloseTo(68 / 7, 6);
  });

  it("returns null for a non-finite rational (zero denominator)", () => {
    expect(coordinateFromExif([[68, 0], [7, 1], [22, 1]], "N")).toBeNull();
  });
});

describe("parseExifDate", () => {
  it("returns nulls for empty / missing input", () => {
    expect(parseExifDate(undefined)).toEqual({ takenAt: null, takenDate: null });
    expect(parseExifDate("")).toEqual({ takenAt: null, takenDate: null });
  });

  it("parses the canonical EXIF datetime format (colon-separated date)", () => {
    const result = parseExifDate("2026:06:08 14:30:00");
    expect(result.takenDate).toBe("2026-06-08");
    expect(result.takenAt).not.toBeNull();
    // takenAt is a valid ISO 8601 instant
    expect(new Date(result.takenAt as string).toISOString()).toBe(result.takenAt);
  });

  it("parses datetime without seconds", () => {
    const result = parseExifDate("2026:06:08 14:30");
    expect(result.takenDate).toBe("2026-06-08");
    expect(result.takenAt).not.toBeNull();
  });

  it("accepts dash-separated and T-separated variants", () => {
    expect(parseExifDate("2026-06-08T14:30:00").takenDate).toBe("2026-06-08");
    expect(parseExifDate("2026-06-08 14:30:00").takenDate).toBe("2026-06-08");
  });

  it("parses a date-only value", () => {
    const result = parseExifDate("2026:06:08");
    expect(result.takenDate).toBe("2026-06-08");
    expect(result.takenAt).not.toBeNull();
  });

  it("rejects an impossible calendar date via round-trip validation", () => {
    // Feb 30 does not exist; takenAt must be null even though the string is well-formed.
    const result = parseExifDate("2026:02:30 10:00:00");
    expect(result.takenAt).toBeNull();
    expect(result.takenDate).toBe("2026-02-30");
  });

  it("rejects an out-of-range time", () => {
    const result = parseExifDate("2026:06:08 25:00:00");
    expect(result.takenAt).toBeNull();
  });

  it("rejects month 13", () => {
    const result = parseExifDate("2026:13:01 10:00:00");
    expect(result.takenAt).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseExifDate("  2026:06:08 14:30:00  ").takenDate).toBe("2026-06-08");
  });
});
