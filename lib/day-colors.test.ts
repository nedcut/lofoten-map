import { describe, expect, it } from "vitest";
import { demoDays } from "./demo-trip";
import { DAY_COLORS, UNASSIGNED_DAY_COLOR, dayColorAt, dayColorFor, dayColorMap } from "./day-colors";

describe("day colors", () => {
  it("assigns palette colours in day order and wraps past the palette", () => {
    expect(dayColorAt(0)).toBe(DAY_COLORS[0]);
    expect(dayColorAt(DAY_COLORS.length)).toBe(DAY_COLORS[0]);
    expect(dayColorAt(-1)).toBe(UNASSIGNED_DAY_COLOR);
  });

  it("maps day ids to colours and falls back for unassigned items", () => {
    const colors = dayColorMap(demoDays);
    expect(colors.get(demoDays[0].id)).toBe(DAY_COLORS[0]);
    expect(colors.get(demoDays[2].id)).toBe(DAY_COLORS[2]);
    expect(dayColorFor(colors, null)).toBe(UNASSIGNED_DAY_COLOR);
    expect(dayColorFor(colors, "missing")).toBe(UNASSIGNED_DAY_COLOR);
    expect(dayColorFor(colors, demoDays[1].id)).toBe(DAY_COLORS[1]);
  });
});
