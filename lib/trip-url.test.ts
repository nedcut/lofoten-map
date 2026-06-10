import { describe, expect, it } from "vitest";
import {
  applyTripUrlState,
  formatDayParam,
  formatItemToken,
  parseItemToken,
  readTripUrlState,
  resolveDayParam,
} from "./trip-url";
import type { Day } from "@/types/trip";

const days: Day[] = [
  { id: "day-1", trip_id: "trip-1", day_number: 1, date: "2026-07-12", title: "Arrival", summary: null, created_at: "2026-01-01T00:00:00.000Z" },
  { id: "day-2", trip_id: "trip-1", day_number: 2, date: "2026-07-13", title: "Hike", summary: null, created_at: "2026-01-01T00:00:00.000Z" },
];

describe("parseItemToken", () => {
  it("parses valid kind:id tokens", () => {
    expect(parseItemToken("photo:abc-123")).toEqual({ kind: "photo", id: "abc-123" });
    expect(parseItemToken("route:seg-9")).toEqual({ kind: "route", id: "seg-9" });
  });

  it("rejects malformed tokens", () => {
    expect(parseItemToken(null)).toBeNull();
    expect(parseItemToken("")).toBeNull();
    expect(parseItemToken("photo")).toBeNull();
    expect(parseItemToken("unknown:abc")).toBeNull();
  });
});

describe("formatItemToken", () => {
  it("round-trips with parseItemToken", () => {
    const token = formatItemToken({ kind: "note", id: "note-42" });
    expect(token).toBe("note:note-42");
    expect(parseItemToken(token)).toEqual({ kind: "note", id: "note-42" });
  });
});

describe("resolveDayParam", () => {
  it("resolves by day number", () => {
    expect(resolveDayParam("2", days)).toBe("day-2");
  });

  it("resolves by day id", () => {
    expect(resolveDayParam("day-1", days)).toBe("day-1");
  });

  it("returns null for unknown values", () => {
    expect(resolveDayParam("99", days)).toBeNull();
    expect(resolveDayParam(null, days)).toBeNull();
  });
});

describe("formatDayParam", () => {
  it("prefers day number for shareable links", () => {
    expect(formatDayParam("day-2", days)).toBe("2");
  });

  it("falls back to the raw id when the day is missing", () => {
    expect(formatDayParam("missing-day", days)).toBe("missing-day");
  });

  it("returns null when no day is selected", () => {
    expect(formatDayParam(null, days)).toBeNull();
  });
});

describe("readTripUrlState", () => {
  it("reads supported search params", () => {
    expect(readTripUrlState("https://example.com/?day=2&journey=photo:x&item=note:y")).toEqual({
      day: "2",
      journey: "photo:x",
      item: "note:y",
    });
  });
});

describe("applyTripUrlState", () => {
  it("builds the next href without touching history in tests", () => {
    const next = applyTripUrlState("https://example.com/", { day: "2", journey: null }, "replace");
    expect(next).toBe("/?day=2");
  });
});
