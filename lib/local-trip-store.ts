import type { Day, LngLat, Note, Photo, Place, RouteSegment, Trip, TripData } from "@/types/trip";

// Pure transforms for the demo-mode (no-Supabase) branches of the trip mutation
// hooks. Every function takes the current TripData and returns a new value
// without mutating the input, so they can be unit-tested in isolation and
// reasoned about independently of React. The Supabase branches reload from the
// server instead and never touch these.

export type DeletableTable = "days" | "route_segments" | "notes" | "places" | "photos";

const byDayNumber = (a: Day, b: Day) => a.day_number - b.day_number;

/** Prepend a freshly-created note (newest first, matching the server ordering). */
export function addNote(data: TripData, note: Note): TripData {
  return { ...data, notes: [note, ...data.notes] };
}

/** Append a freshly-created route segment. */
export function addRoute(data: TripData, route: RouteSegment): TripData {
  return { ...data, routeSegments: [...data.routeSegments, route] };
}

/** Prepend freshly-created photos (newest first). */
export function prependPhotos(data: TripData, photos: Photo[]): TripData {
  return { ...data, photos: [...photos, ...data.photos] };
}

/** Merge a patch into the trip, leaving a null trip untouched. */
export function patchTrip(data: TripData, patch: Partial<Trip>): TripData {
  return { ...data, trip: data.trip ? { ...data.trip, ...patch } : data.trip };
}

/** Append a new day and keep the list ordered by day number. */
export function addDay(data: TripData, day: Day): TripData {
  return { ...data, days: [...data.days, day].sort(byDayNumber) };
}

/** Merge a patch into one day and re-sort (day_number may have changed). */
export function patchDay(data: TripData, dayId: string, patch: Partial<Day>): TripData {
  return {
    ...data,
    days: data.days.map((day) => (day.id === dayId ? { ...day, ...patch } : day)).sort(byDayNumber),
  };
}

/** Merge a patch into one route segment. */
export function patchRoute(data: TripData, routeId: string, patch: Partial<RouteSegment>): TripData {
  return { ...data, routeSegments: data.routeSegments.map((route) => (route.id === routeId ? { ...route, ...patch } : route)) };
}

/** Merge a patch into one note. */
export function patchNote(data: TripData, noteId: string, patch: Partial<Note>): TripData {
  return { ...data, notes: data.notes.map((note) => (note.id === noteId ? { ...note, ...patch } : note)) };
}

/** Merge a patch into one place. */
export function patchPlace(data: TripData, placeId: string, patch: Partial<Place>): TripData {
  return { ...data, places: data.places.map((place) => (place.id === placeId ? { ...place, ...patch } : place)) };
}

/** Merge a patch into one photo. */
export function patchPhoto(data: TripData, photoId: string, patch: Partial<Photo>): TripData {
  return { ...data, photos: data.photos.map((photo) => (photo.id === photoId ? { ...photo, ...patch } : photo)) };
}

/** Optimistically move a photo's marker to a new coordinate. */
export function movePhoto(data: TripData, photoId: string, coordinate: LngLat): TripData {
  return patchPhoto(data, photoId, { lat: coordinate.lat, lng: coordinate.lng });
}

/** Append the days/routes/notes produced by a GPX import (notes prepended). */
export function appendGpxImport(
  data: TripData,
  imported: { days: Day[]; routes: RouteSegment[]; notes: Note[] },
): TripData {
  return {
    ...data,
    days: [...data.days, ...imported.days].sort(byDayNumber),
    routeSegments: [...data.routeSegments, ...imported.routes],
    notes: [...imported.notes, ...data.notes],
  };
}

export interface DeleteResult {
  data: TripData;
  /** Blob object-URLs the caller should revoke (only set when deleting a photo). */
  revokedUrls: string[];
}

/**
 * Delete one item. Deleting a day is a cascade: the day row is removed and every
 * other table that referenced it has its `day_id` nulled (items become
 * unassigned rather than disappearing). Deleting a photo also reports any
 * `blob:` object-URLs the caller must revoke to avoid leaking memory.
 */
export function deleteItem(data: TripData, table: DeletableTable, id: string): DeleteResult {
  const revokedUrls: string[] = [];
  if (table === "photos") {
    const deletedPhoto = data.photos.find((item) => item.id === id);
    if (deletedPhoto?.image_url?.startsWith("blob:")) revokedUrls.push(deletedPhoto.image_url);
    if (deletedPhoto?.thumbnail_url?.startsWith("blob:")) revokedUrls.push(deletedPhoto.thumbnail_url);
  }

  // When a day is deleted, orphan its children by nulling their day_id. For any
  // other table this map is a no-op (the day-detach branch never matches).
  const detachDay = <T extends { day_id: string | null }>(items: T[]): T[] =>
    table === "days" ? items.map((item) => (item.day_id === id ? { ...item, day_id: null } : item)) : items;

  return {
    revokedUrls,
    data: {
      ...data,
      days: table === "days" ? data.days.filter((item) => item.id !== id) : data.days,
      notes: table === "notes" ? data.notes.filter((item) => item.id !== id) : detachDay(data.notes),
      places: table === "places" ? data.places.filter((item) => item.id !== id) : detachDay(data.places),
      photos: table === "photos" ? data.photos.filter((item) => item.id !== id) : detachDay(data.photos),
      routeSegments: table === "route_segments"
        ? data.routeSegments.filter((item) => item.id !== id)
        : detachDay(data.routeSegments),
    },
  };
}
