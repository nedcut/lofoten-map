import type { Day } from "@/types/trip";

// One accent per trip day, used consistently on the day cards, route lines,
// photo-marker badges, and the on-map day chip so a colour always means the
// same day everywhere. Hues are picked to stay legible over the Mapbox
// outdoors style (mostly greens, greys, and blues) and to be distinguishable
// from each other. Trips longer than the palette wrap around.
export const DAY_COLORS = [
  "#0f766e", // teal
  "#d0872f", // ember
  "#7c3aed", // violet
  "#e11d48", // rose
  "#1d4ed8", // blue
  "#c026d3", // fuchsia
  "#0891b2", // cyan
  "#a16207", // gold
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
