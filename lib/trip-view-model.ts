import type { PhotoOutlier } from "@/lib/photo-outliers";
import type { Note, Photo, Place, RouteMode, RouteSegment, TripData } from "@/types/trip";

export type TripDayStats = {
  photos: number;
  videos: number;
  journal: number;
  distanceMeters: number;
  // Distance broken out by how it was covered, so a 90 km ferry day doesn't
  // read like a 90 km hike.
  distanceByMode: Partial<Record<RouteMode, number>>;
};
export type TripEditTarget =
  | { kind: "photo"; item: Photo }
  | { kind: "note"; item: Note }
  | { kind: "place"; item: Place }
  | { kind: "route"; item: RouteSegment };

export function filterItemsByDay<T extends { day_id: string | null }>(items: T[], selectedDayId: string | null): T[] {
  return selectedDayId ? items.filter((item) => item.day_id === selectedDayId) : items;
}

export function filterTripItemsByDay(data: TripData, selectedDayId: string | null) {
  return {
    routes: filterItemsByDay(data.routeSegments, selectedDayId),
    photos: filterItemsByDay(data.photos, selectedDayId),
    notes: filterItemsByDay(data.notes, selectedDayId),
    places: filterItemsByDay(data.places, selectedDayId),
  };
}

// Stats describe the complete day, independent of the currently selected map
// filter. Items without a day intentionally do not create a sidebar entry.
export function deriveDayStats(data: TripData) {
  const stats = new Map<string, TripDayStats>();
  const forDay = (dayId: string | null) => {
    if (!dayId) return null;
    let entry = stats.get(dayId);
    if (!entry) {
      entry = { photos: 0, videos: 0, journal: 0, distanceMeters: 0, distanceByMode: {} };
      stats.set(dayId, entry);
    }
    return entry;
  };
  for (const photo of data.photos) {
    const entry = forDay(photo.day_id);
    if (!entry) continue;
    if (photo.media_type === "video") entry.videos += 1;
    else entry.photos += 1;
  }
  for (const note of data.notes) { const entry = forDay(note.day_id); if (entry) entry.journal += 1; }
  for (const place of data.places) { const entry = forDay(place.day_id); if (entry) entry.journal += 1; }
  for (const route of data.routeSegments) {
    const entry = forDay(route.day_id);
    if (!entry) continue;
    const meters = route.distance_meters ?? 0;
    entry.distanceMeters += meters;
    if (meters > 0) entry.distanceByMode[route.mode] = (entry.distanceByMode[route.mode] ?? 0) + meters;
  }
  return stats;
}

// "14 photos", "2 videos", or "14 photos · 2 videos" — never the vague "media".
export function formatMediaCount(photos: number, videos: number): string | null {
  const parts = [
    photos > 0 ? `${photos} photo${photos === 1 ? "" : "s"}` : null,
    videos > 0 ? `${videos} video${videos === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatKm(meters: number): string | null {
  const km = meters / 1000;
  if (km < 0.1) return null;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

const MODE_LABEL: Record<RouteMode, string> = { hike: "hike", walk: "walk", ferry: "ferry", bus: "bus", other: "" };
const MODE_ORDER: RouteMode[] = ["hike", "walk", "bus", "ferry", "other"];

// Distance labelled by how it was covered: "15 km hike · 75 km ferry". A day
// with a single mode still names it; a day with only "other" routes shows a
// bare distance.
export function formatDistanceByMode(distanceByMode: Partial<Record<RouteMode, number>>, totalMeters: number): string | null {
  const parts = MODE_ORDER
    .map((mode) => {
      const km = formatKm(distanceByMode[mode] ?? 0);
      if (!km) return null;
      return MODE_LABEL[mode] ? `${km} ${MODE_LABEL[mode]}` : km;
    })
    .filter((part): part is string => Boolean(part));
  if (parts.length > 0) return parts.join(" · ");
  return formatKm(totalMeters);
}

// The whole stats line for a day card: "14 photos · 2 pins · 15 km hike".
// Only the parts a day actually has.
export function formatDayStats(stats: TripDayStats | undefined): string | null {
  if (!stats) return null;
  const parts = [
    formatMediaCount(stats.photos, stats.videos),
    stats.journal ? `${stats.journal} pin${stats.journal === 1 ? "" : "s"}` : null,
    formatDistanceByMode(stats.distanceByMode, stats.distanceMeters),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function resolveEditTarget(data: TripData, target: { kind: TripEditTarget["kind"]; id: string } | null): TripEditTarget | null {
  if (!target) return null;
  const { kind, id } = target;
  if (kind === "photo") { const item = data.photos.find((photo) => photo.id === id); return item ? { kind, item } : null; }
  if (kind === "note") { const item = data.notes.find((note) => note.id === id); return item ? { kind, item } : null; }
  if (kind === "place") { const item = data.places.find((place) => place.id === id); return item ? { kind, item } : null; }
  const item = data.routeSegments.find((route) => route.id === id);
  return item ? { kind, item } : null;
}

export function deriveOutlierOverlay(outlier: PhotoOutlier | null) {
  if (!outlier || outlier.photo.lng === null || outlier.photo.lat === null) return null;
  return {
    photo: { lng: outlier.photo.lng, lat: outlier.photo.lat },
    suggested: outlier.suggested,
    neighbors: outlier.neighbors,
  };
}
