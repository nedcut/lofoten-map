import type { PhotoOutlier } from "@/lib/photo-outliers";
import type { Note, Photo, Place, RouteSegment, TripData } from "@/types/trip";

export type TripDayStats = { media: number; journal: number; distanceMeters: number };
export type TripEditTarget =
  | { kind: "photo"; item: Photo }
  | { kind: "note"; item: Note }
  | { kind: "place"; item: Place }
  | { kind: "route"; item: RouteSegment };

export function filterTripItemsByDay(data: TripData, selectedDayId: string | null) {
  const matches = (dayId: string | null) => !selectedDayId || dayId === selectedDayId;
  return {
    routes: data.routeSegments.filter((item) => matches(item.day_id)),
    photos: data.photos.filter((item) => matches(item.day_id)),
    notes: data.notes.filter((item) => matches(item.day_id)),
    places: data.places.filter((item) => matches(item.day_id)),
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
      entry = { media: 0, journal: 0, distanceMeters: 0 };
      stats.set(dayId, entry);
    }
    return entry;
  };
  for (const photo of data.photos) { const entry = forDay(photo.day_id); if (entry) entry.media += 1; }
  for (const note of data.notes) { const entry = forDay(note.day_id); if (entry) entry.journal += 1; }
  for (const place of data.places) { const entry = forDay(place.day_id); if (entry) entry.journal += 1; }
  for (const route of data.routeSegments) { const entry = forDay(route.day_id); if (entry) entry.distanceMeters += route.distance_meters ?? 0; }
  return stats;
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
