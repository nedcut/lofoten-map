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
  dayBucket: number;
  dayNumber: number | null;
  group: number;
  time: number;
  created: number;
  id: string;
};

export type BuildJourneyOptions = {
  dayId?: string | null;
  attachmentRadiusMeters?: number;
};

const DEFAULT_ATTACHMENT_RADIUS_METERS = 100;

function timestamp(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function dayMap(days: Day[]) {
  return new Map(days.map((day) => [day.id, day]));
}

function dayBucket(daysById: Map<string, Day>, dayId: string | null) {
  if (!dayId) return { dayBucket: 1, dayNumber: null };
  const day = daysById.get(dayId);
  return { dayBucket: day ? 0 : 1, dayNumber: day?.day_number ?? null };
}

function coordOf(item: Pick<Photo, "lat" | "lng"> | Pick<Note, "lat" | "lng"> | Pick<Place, "lat" | "lng">) {
  if (item.lat === null || item.lng === null) return null;
  return { lat: item.lat, lng: item.lng };
}

function sortKey(daysById: Map<string, Day>, id: string, dayId: string | null, group: number, timeValue: string | null | undefined, createdAt: string) {
  const bucket = dayBucket(daysById, dayId);
  return {
    ...bucket,
    group,
    time: timestamp(timeValue),
    created: timestamp(createdAt),
    id,
  };
}

function compareSort(a: JourneySortKey, b: JourneySortKey) {
  return a.dayBucket - b.dayBucket
    || (a.dayNumber ?? Number.POSITIVE_INFINITY) - (b.dayNumber ?? Number.POSITIVE_INFINITY)
    || a.group - b.group
    || a.time - b.time
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
      const hasTakenAt = Number.isFinite(timestamp(photo.taken_at));
      return {
        id: `photo:${photo.id}`,
        kind: "photo" as const,
        dayId: photo.day_id,
        coord: coordOf(photo),
        primary: photo,
        attached: attachedByPhotoId.get(photo.id) ?? [],
        sort: sortKey(daysById, `photo:${photo.id}`, photo.day_id, hasTakenAt ? 0 : 1, photo.taken_at, photo.created_at),
      };
    }),
    ...data.notes.filter((note) => includeDay(note.day_id) && !attachedIds.has(`note:${note.id}`)).map((note) => ({
      id: `note:${note.id}`,
      kind: "note" as const,
      dayId: note.day_id,
      coord: coordOf(note),
      primary: note,
      attached: [],
      sort: sortKey(daysById, `note:${note.id}`, note.day_id, 2, null, note.created_at),
    })),
    ...data.places.filter((place) => includeDay(place.day_id) && !attachedIds.has(`place:${place.id}`)).map((place) => ({
      id: `place:${place.id}`,
      kind: "place" as const,
      dayId: place.day_id,
      coord: coordOf(place),
      primary: place,
      attached: [],
      sort: sortKey(daysById, `place:${place.id}`, place.day_id, 2, null, place.created_at),
    })),
  ];

  return items.sort((a, b) => compareSort(a.sort, b.sort));
}

export function journeyItemTitle(item: JourneyItem) {
  if (item.kind === "photo") return item.primary.caption || "Untitled photo";
  if (item.kind === "note") return item.primary.body;
  return item.primary.name;
}
