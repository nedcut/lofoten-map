// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveEditedTakenAt, tripDateTimeInputValue } from "./trip-time";

describe("resolveEditedTakenAt with a real datetime-local input", () => {
  it("keeps the stored value for an untouched field whose seconds are zero", () => {
    const stored = "2026-07-12T22:30:00.123Z";
    const initial = tripDateTimeInputValue(stored);
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.step = "1";
    input.defaultValue = initial;

    expect(resolveEditedTakenAt(input.value, initial, stored)).toBe(stored);
  });
});
