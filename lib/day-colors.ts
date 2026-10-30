import type { Day } from "@/types/trip";

// One accent per trip day, used consistently on the day cards, route lines,
// photo-marker badges, and the on-map day chip so a colour always means the
// same day everywhere. The hues are taken from the islands themselves (fjord
// water, cloudberries, the red rorbu fishing cabins, slate sea, heather,
// glacier melt, lingonberries, birch in low sun) so the routes sit in the
// landscape instead of on top of it, while staying distinct from each other
// and legible over the terrain basemap. Trips longer than the palette wrap.
export const DAY_COLORS = [
  "#0f766e", // fjord
  "#d0872f", // cloudberry
  "#b23a2b", // rorbu red
  "#2f5f9e", // slate sea
  "#7b4f9e", // heather
  "#1b8aa0", // glacier
  "#b0305f", // lingonberry
  "#9a7419", // birch gold
] as const;

// Fallback for items that belong to no day (or an unknown one).
export const UNASSIGNED_DAY_COLOR = "#57534e";

export function dayColorAt(index: number): string {
  if (!Number.isFinite(index) || index < 0) return UNASSIGNED_DAY_COLOR;
  return DAY_COLORS[index % DAY_COLORS.length];
}

// Keyed by day id, in the order the days are listed (day_number order as
// delivered by the data layer), so Day 1 is always the first colour.
export function dayColorMap(days: Day[]): Map<string, string> {
  return new Map(days.map((day, index) => [day.id, dayColorAt(index)]));
}

export function dayColorFor(colors: Map<string, string>, dayId: string | null | undefined): string {
  return (dayId && colors.get(dayId)) || UNASSIGNED_DAY_COLOR;
}
