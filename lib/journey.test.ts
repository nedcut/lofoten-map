import { describe, expect, it } from "vitest";
import { buildJourneyItems } from "./journey";
import type { Day, Note, Photo, Place, TripData } from "@/types/trip";

const tripId = "trip";
const created = "2026-01-01T00:00:00.000Z";
const days: Day[] = [
  { id: "day-1", trip_id: tripId, day_number: 1, date: "2026-07-12", title: "One", summary: null, created_at: created },
  { id: "day-2", trip_id: tripId, day_number: 2, date: "2026-07-13", title: "Two", summary: null, created_at: created },
];

function photo(input: Partial<Photo> & Pick<Photo, "id">): Photo {
  return {
    id: input.id,
    trip_id: tripId,
    day_id: "day_id" in input ? input.day_id! : "day-1",
    user_id: null,
    uploader_name: null,
    content_hash: null,
    image_path: "",
    thumbnail_path: null,
    image_url: null,
    thumbnail_url: null,
    lat: input.lat ?? 67.9,
    lng: input.lng ?? 13.0,
    taken_at: input.taken_at ?? null,
    caption: input.caption ?? null,
    exif_found: false,
    created_at: input.created_at ?? created,
  };
}

function note(input: Partial<Note> & Pick<Note, "id">): Note {
  return {
    id: input.id,
    trip_id: tripId,
    day_id: input.day_id ?? "day-1",
    user_id: null,
    author_name: null,
    lat: input.lat ?? 67.9,
    lng: input.lng ?? 13.0,
    body: input.body ?? input.id,
    note_type: "note",
    created_at: input.created_at ?? created,
  };
}

function place(input: Partial<Place> & Pick<Place, "id">): Place {
  return {
    id: input.id,
    trip_id: tripId,
    day_id: input.day_id ?? "day-1",
    name: input.name ?? input.id,
    lat: input.lat ?? 67.9,
    lng: input.lng ?? 13.0,
    place_type: null,
    description: null,
    created_at: input.created_at ?? created,
  };
}

function data(input: Partial<TripData>): TripData {
  return {
    trip: null,
    days,
    routeSegments: [],
    photos: [],
    notes: [],
    places: [],
    members: [],
    adminRequests: [],
    ...input,
  };
}

describe("buildJourneyItems", () => {
  it("orders by day, timed photos, untimed photos, then notes and places", () => {
    const items = buildJourneyItems(data({
      photos: [
        photo({ id: "untimed", created_at: "2026-07-12T09:00:00Z" }),
        photo({ id: "later", taken_at: "2026-07-12T11:00:00Z" }),
        photo({ id: "day-two", day_id: "day-2", taken_at: "2026-07-13T08:00:00Z" }),
        photo({ id: "earlier", taken_at: "2026-07-12T08:00:00Z" }),
      ],
      notes: [note({ id: "note-far", lat: 67.91, created_at: "2026-07-12T07:00:00Z" })],
      places: [place({ id: "place-far", lng: 13.02, created_at: "2026-07-12T06:00:00Z" })],
    }), { attachmentRadiusMeters: 10 });

    expect(items.map((item) => item.id)).toEqual([
      "photo:earlier",
      "photo:later",
      "photo:untimed",
      "place:place-far",
      "note:note-far",
      "photo:day-two",
    ]);
  });

  it("attaches nearby notes and places to same-day photos", () => {
    const items = buildJourneyItems(data({
      photos: [photo({ id: "anchor", lat: 67.9, lng: 13 })],
      notes: [note({ id: "near-note", lat: 67.9002, lng: 13.0002 })],
      places: [place({ id: "near-place", lat: 67.9003, lng: 13.0002 })],
    }), { attachmentRadiusMeters: 100 });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("photo:anchor");
    expect(items[0].attached.map((attached) => `${attached.kind}:${attached.item.id}`)).toEqual(["note:near-note", "place:near-place"]);
  });

  it("keeps unsorted items after known trip days", () => {
    const items = buildJourneyItems(data({
      photos: [
        photo({ id: "known", day_id: "day-2", taken_at: "2026-07-13T08:00:00Z" }),
        photo({ id: "unsorted", day_id: null, taken_at: "2026-07-10T08:00:00Z" }),
      ],
    }));

    expect(items.map((item) => item.id)).toEqual(["photo:known", "photo:unsorted"]);
  });
});
