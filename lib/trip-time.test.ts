import { describe, expect, it } from "vitest";
import { resolveEditedTakenAt, tripDateTimeInputToIso, tripDateTimeInputValue, tripDayStartMs } from "./trip-time";

describe("tripDateTimeInputValue", () => {
  it("shows a summer instant as Oslo wall-clock time (UTC+2), with seconds", () => {
    expect(tripDateTimeInputValue("2026-07-12T22:30:45.000Z")).toBe("2026-07-13T00:30:45");
  });

  it("shows a winter instant as Oslo wall-clock time (UTC+1)", () => {
    expect(tripDateTimeInputValue("2026-01-15T10:20:30.000Z")).toBe("2026-01-15T11:20:30");
  });

  it("returns an empty string for null or unparseable input", () => {
    expect(tripDateTimeInputValue(null)).toBe("");
    expect(tripDateTimeInputValue("not a date")).toBe("");
  });
});

describe("tripDateTimeInputToIso", () => {
  it("round-trips a summer instant", () => {
    const iso = "2026-07-12T22:30:45.000Z";
    expect(tripDateTimeInputToIso(tripDateTimeInputValue(iso))).toBe(iso);
  });

  it("round-trips a winter instant", () => {
    const iso = "2026-01-15T10:20:30.000Z";
    expect(tripDateTimeInputToIso(tripDateTimeInputValue(iso))).toBe(iso);
  });

  it("accepts minute-only input", () => {
    expect(tripDateTimeInputToIso("2026-07-13T00:30")).toBe("2026-07-12T22:30:00.000Z");
  });

  it("returns null for empty or invalid input", () => {
    expect(tripDateTimeInputToIso("")).toBeNull();
    expect(tripDateTimeInputToIso("garbage")).toBeNull();
    expect(tripDateTimeInputToIso("2026-02-30T10:00")).toBeNull();
  });
});

describe("tripDayStartMs", () => {
  it("is 00:00 Oslo time on the date", () => {
    expect(tripDayStartMs("2026-07-12")).toBe(Date.parse("2026-07-11T22:00:00Z"));
    expect(tripDayStartMs("2026-01-15")).toBe(Date.parse("2026-01-14T23:00:00Z"));
  });

  it("returns null for an invalid date", () => {
    expect(tripDayStartMs("nope")).toBeNull();
    expect(tripDayStartMs("2026-02-30")).toBeNull();
  });
});

describe("resolveEditedTakenAt", () => {
  const stored = "2026-07-12T22:30:45.123Z";
  const initial = tripDateTimeInputValue(stored);

  it("keeps the stored value exactly when the field is untouched", () => {
    expect(resolveEditedTakenAt(initial, initial, stored)).toBe(stored);
  });

  it("saves the new instant when the field changed", () => {
    expect(resolveEditedTakenAt("2026-07-13T01:00:00", initial, stored)).toBe("2026-07-12T23:00:00.000Z");
  });

  it("saves null when the field was emptied", () => {
    expect(resolveEditedTakenAt("", initial, stored)).toBeNull();
  });

  it("keeps null when there was no time and none was entered", () => {
    expect(resolveEditedTakenAt("", "", null)).toBeNull();
  });
});
