import type { Day, Note, Photo, Place, TripData } from "@/types/trip";

export type JourneyAttachedItem = { kind: "note"; item: Note } | { kind: "place"; item: Place };

export type JourneyItem =
  | {
    id: string;
    kind: "photo";
    dayId: string | null;
    coord: { lng: number; lat: number } | null;
    primary: Photo;
    attached: JourneyAttachedItem[];
    sort: JourneySortKey;
  }
  | {
    id: string;
    kind: "note";
    dayId: string | null;
    coord: { lng: number; lat: number } | null;
    primary: Note;
    attached: JourneyAttachedItem[];
    sort: JourneySortKey;
  }
  | {
    id: string;
    kind: "place";
    dayId: string | null;
    coord: { lng: number; lat: number } | null;
    primary: Place;
    attached: JourneyAttachedItem[];
    sort: JourneySortKey;
  };

type JourneySortKey = {
  time: number;
  group: number;
  created: number;
  id: string;
};

export type BuildJourneyOptions = {
  dayId?: string | null;
  attachmentRadiusMeters?: number;
};

const DEFAULT_ATTACHMENT_RADIUS_METERS = 100;
const DAY_MS = 86_400_000;

function timestamp(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function dayMap(days: Day[]) {
  return new Map(days.map((day) => [day.id, day]));
}

// Midnight (UTC) of a day's calendar date, or null when the item has no day or
// its day has no date set.
function dayDateMs(daysById: Map<string, Day>, dayId: string | null) {
  if (!dayId) return null;
  const date = daysById.get(dayId)?.date;
  if (!date) return null;
  const ms = new Date(`${date}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Effective sort time for items that have no timestamp of their own. They land
// at the end of their assigned day (untimed photos just ahead of journal items),
// or at the very end of the journey when no day date is known.
function fallbackTime(daysById: Map<string, Day>, dayId: string | null, slot: "photo" | "journal") {
  const ms = dayDateMs(daysById, dayId);
  if (ms === null) return Number.POSITIVE_INFINITY;
  return ms + (slot === "photo" ? DAY_MS - 2 : DAY_MS - 1);
}

function coordOf(item: Pick<Photo, "lat" | "lng"> | Pick<Note, "lat" | "lng"> | Pick<Place, "lat" | "lng">) {
  if (item.lat === null || item.lng === null) return null;
  return { lat: item.lat, lng: item.lng };
}

function compareSort(a: JourneySortKey, b: JourneySortKey) {
  // Strictly chronological: a real timestamp always wins, regardless of which
  // day a photo was tagged to. Items sharing an effective time (e.g. journal
  // items on the same day) fall back to kind, then creation order. Equal
  // Infinity times compare as 0 rather than NaN.
  const timeDiff = a.time === b.time ? 0 : a.time - b.time;
  return timeDiff
    || a.group - b.group
    || a.created - b.created
    || a.id.localeCompare(b.id);
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radius = 6_371_000;
  const phi1 = a.lat * Math.PI / 180;
  const phi2 = b.lat * Math.PI / 180;
  const deltaPhi = (b.lat - a.lat) * Math.PI / 180;
  const deltaLambda = (b.lng - a.lng) * Math.PI / 180;
  const haversine = Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function nearestPhoto(item: Note | Place, photos: Photo[], radiusMeters: number) {
  const itemCoord = coordOf(item);
  if (!itemCoord) return null;
  let best: { photo: Photo; distance: number } | null = null;
  for (const photo of photos) {
    if (photo.day_id !== item.day_id) continue;
    const photoCoord = coordOf(photo);
    if (!photoCoord) continue;
    const distance = distanceMeters(itemCoord, photoCoord);
    if (distance <= radiusMeters && (!best || distance < best.distance)) best = { photo, distance };
  }
  return best?.photo ?? null;
}

export function buildJourneyItems(data: TripData, options: BuildJourneyOptions = {}): JourneyItem[] {
  const radiusMeters = options.attachmentRadiusMeters ?? DEFAULT_ATTACHMENT_RADIUS_METERS;
  const daysById = dayMap(data.days);
  const includeDay = (dayId: string | null) => options.dayId === undefined || options.dayId === null || dayId === options.dayId;
  const photos = data.photos.filter((photo) => includeDay(photo.day_id));
  const attachedByPhotoId = new Map<string, JourneyAttachedItem[]>();
  const attachedIds = new Set<string>();

  for (const note of data.notes.filter((item) => includeDay(item.day_id))) {
    const photo = nearestPhoto(note, photos, radiusMeters);
    if (!photo) continue;
    attachedIds.add(`note:${note.id}`);
    attachedByPhotoId.set(photo.id, [...(attachedByPhotoId.get(photo.id) ?? []), { kind: "note", item: note }]);
  }

  for (const place of data.places.filter((item) => includeDay(item.day_id))) {
    const photo = nearestPhoto(place, photos, radiusMeters);
    if (!photo) continue;
    attachedIds.add(`place:${place.id}`);
    attachedByPhotoId.set(photo.id, [...(attachedByPhotoId.get(photo.id) ?? []), { kind: "place", item: place }]);
  }

  const items: JourneyItem[] = [
    ...photos.map((photo) => {
      const id = `photo:${photo.id}`;
      const takenAtMs = timestamp(photo.taken_at);
      const timed = Number.isFinite(takenAtMs);
      return {
        id,
        kind: "photo" as const,
        dayId: photo.day_id,
        coord: coordOf(photo),
        primary: photo,
        attached: attachedByPhotoId.get(photo.id) ?? [],
        sort: {
          time: timed ? takenAtMs : fallbackTime(daysById, photo.day_id, "photo"),
          group: timed ? 0 : 1,
          created: timestamp(photo.created_at),
          id,
        },
      };
    }),
    ...data.notes.filter((note) => includeDay(note.day_id) && !attachedIds.has(`note:${note.id}`)).map((note) => {
      const id = `note:${note.id}`;
      return {
        id,
        kind: "note" as const,
        dayId: note.day_id,
        coord: coordOf(note),
        primary: note,
        attached: [],
        sort: { time: fallbackTime(daysById, note.day_id, "journal"), group: 2, created: timestamp(note.created_at), id },
      };
    }),
    ...data.places.filter((place) => includeDay(place.day_id) && !attachedIds.has(`place:${place.id}`)).map((place) => {
      const id = `place:${place.id}`;
      return {
        id,
        kind: "place" as const,
        dayId: place.day_id,
        coord: coordOf(place),
        primary: place,
        attached: [],
        sort: { time: fallbackTime(daysById, place.day_id, "journal"), group: 2, created: timestamp(place.created_at), id },
      };
    }),
  ];

  return items.sort((a, b) => compareSort(a.sort, b.sort));
}

export function journeyItemTitle(item: JourneyItem) {
  if (item.kind === "photo") return item.primary.caption || "Untitled photo";
  if (item.kind === "note") return item.primary.body;
  return item.primary.name;
}
