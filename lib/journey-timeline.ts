import type { Day } from "@/types/trip";

type TimelineItem = { dayId: string | null };

export type JourneyDayStop = {
  /** The day's id, or null for items with no day ("Unsorted"). */
  dayId: string | null;
  day: Day | null;
  /** Index of the day's first moment in journey (chronological) order. */
  firstIndex: number;
};

/**
 * One entry per day present in the journey, for the day picker. The journey
 * stays in chronological media order, so a day can recur (a late-uploaded
 * photo filed under Day 2 after Day 7's photos); picking such a day jumps to
 * its first occurrence. Ordered by day number, with Unsorted last.
 */
export function journeyDayStops(items: TimelineItem[], days: Day[]): JourneyDayStop[] {
  const byId = new Map(days.map((day) => [day.id, day]));
  const firstIndex = new Map<string | null, number>();
  items.forEach((item, index) => {
    // An id with no matching day reads as Unsorted, the same as dayLabel.
    const key = item.dayId && byId.has(item.dayId) ? item.dayId : null;
    if (!firstIndex.has(key)) firstIndex.set(key, index);
  });
  return [...firstIndex.entries()]
    .map(([dayId, index]) => ({ dayId, day: dayId ? byId.get(dayId) ?? null : null, firstIndex: index }))
    .sort((a, b) => (a.day?.day_number ?? Infinity) - (b.day?.day_number ?? Infinity));
}

export type JourneyTimelineTick = {
  index: number;
  dayId: string | null;
  /** Position along the track, 0–100. */
  left: number;
};

/**
 * Markers for where the day changes along the progress track. Purely
 * indicative (the slider and the day picker do the navigating), so a tick
 * that would land within `minGapPx` of the previous kept tick is merged into
 * it rather than stacked on top: a burst of late transitions (Unsorted, Day 2,
 * Unsorted, Day 1…) collapses to one dot instead of a pile of overlapping ones.
 * Until the track is measured (`trackWidth <= 0`) nothing is merged.
 */
export function journeyTimelineTicks(items: TimelineItem[], trackWidth: number, minGapPx: number): JourneyTimelineTick[] {
  const ticks: JourneyTimelineTick[] = [];
  let lastPx = -Infinity;
  items.forEach((item, index) => {
    if (index > 0 && item.dayId === items[index - 1].dayId) return;
    const left = items.length <= 1 ? 0 : (index / (items.length - 1)) * 100;
    const px = (left / 100) * trackWidth;
    if (trackWidth > 0 && px - lastPx < minGapPx) return;
    ticks.push({ index, dayId: item.dayId, left });
    lastPx = px;
  });
  return ticks;
}
