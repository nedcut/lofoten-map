import { describe, expect, it } from "vitest";
import { journeyDayStops, journeyTimelineTicks } from "./journey-timeline";
import type { Day } from "@/types/trip";

const created = "2026-01-01T00:00:00.000Z";
function day(n: number): Day {
  return { id: `day-${n}`, trip_id: "trip", day_number: n, date: null, title: null, summary: null, created_at: created };
}
const days = [day(1), day(2), day(3)];
const items = (ids: (string | null)[]) => ids.map((dayId) => ({ dayId }));

describe("journeyDayStops", () => {
  it("lists each day once, in day order, jumping to its first moment even when it recurs later", () => {
    // Chronological order revisits Day 1 and Day 2 after Day 3 (late uploads).
    const stops = journeyDayStops(items(["day-1", "day-1", "day-2", "day-3", null, "day-2", null, "day-1"]), days);
    expect(stops.map((stop) => [stop.day?.day_number ?? "unsorted", stop.firstIndex])).toEqual([
      [1, 0],
      [2, 2],
      [3, 3],
      ["unsorted", 4],
    ]);
  });

  it("omits days with no moments and files unknown day ids under Unsorted", () => {
    const stops = journeyDayStops(items(["day-3", "deleted-day", null]), days);
    expect(stops.map((stop) => [stop.dayId, stop.firstIndex])).toEqual([
      ["day-3", 0],
      [null, 1],
    ]);
  });
});

describe("journeyTimelineTicks", () => {
  it("marks every day change when the track is wide enough", () => {
    const ticks = journeyTimelineTicks(items(["day-1", "day-1", "day-2", "day-3"]), 1000, 10);
    expect(ticks.map((tick) => [tick.index, tick.dayId])).toEqual([[0, "day-1"], [2, "day-2"], [3, "day-3"]]);
  });

  it("merges a burst of late transitions so no two dots overlap", () => {
    // 100 moments on a 335px track: transitions at 95–99 sit ~3.4px apart,
    // so only every third one has room for its own dot.
    const ids: (string | null)[] = Array.from({ length: 95 }, (_, index) => (index < 50 ? "day-1" : "day-3"));
    ids.push(null, "day-2", null, "day-1", null);
    const ticks = journeyTimelineTicks(items(ids), 335, 10);
    expect(ticks.map((tick) => tick.index)).toEqual([0, 50, 95, 98]);
    const px = ticks.map((tick) => (tick.left / 100) * 335);
    for (let i = 1; i < px.length; i += 1) expect(px[i] - px[i - 1]).toBeGreaterThanOrEqual(10);
  });

  it("keeps every transition until the track has been measured", () => {
    const ticks = journeyTimelineTicks(items(["day-1", null, "day-2", null]), 0, 10);
    expect(ticks).toHaveLength(4);
  });
});
