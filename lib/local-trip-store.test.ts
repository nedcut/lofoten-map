import { describe, expect, it } from "vitest";
import {
  addDay,
  addNote,
  addRoute,
  appendGpxImport,
  deleteItem,
  movePhoto,
  patchDay,
  patchTrip,
  prependPhotos,
} from "./local-trip-store";
import type { Day, Note, Photo, RouteSegment, TripData } from "@/types/trip";

const day = (id: string, day_number: number): Day => ({
  id,
  trip_id: "trip-1",
  day_number,
  date: null,
  title: null,
  summary: null,
  created_at: "2026-01-01T00:00:00Z",
});

const photo = (id: string, day_id: string | null, extra: Partial<Photo> = {}): Photo => ({
  id,
  trip_id: "trip-1",
  day_id,
  user_id: null,
  uploader_name: "Friend",
  content_hash: null,
  media_type: "photo",
  image_path: "",
  thumbnail_path: null,
  image_url: null,
  thumbnail_url: null,
  lat: 68,
  lng: 13,
  taken_at: null,
  caption: null,
  exif_found: false,
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});

const note = (id: string, day_id: string | null): Note => ({
  id,
  trip_id: "trip-1",
  day_id,
  user_id: null,
  author_name: "Friend",
  lat: 68,
  lng: 13,
  body: "hi",
  note_type: "note",
  created_at: "2026-01-01T00:00:00Z",
});

const route = (id: string, day_id: string | null): RouteSegment => ({
  id,
  trip_id: "trip-1",
  day_id,
  name: "Route",
  source: "manual",
  mode: "hike",
  geometry_geojson: { type: "LineString", coordinates: [[13, 68], [13.1, 68.1]] },
  distance_meters: 100,
  elevation_gain_meters: null,
  created_at: "2026-01-01T00:00:00Z",
});

function baseData(): TripData {
  return {
    trip: { id: "trip-1", title: "Trip", slug: "trip", description: null, start_date: null, end_date: null, created_at: "2026-01-01T00:00:00Z" },
    days: [day("d1", 1), day("d2", 2)],
    routeSegments: [route("r1", "d1")],
    photos: [photo("p1", "d1"), photo("p2", "d2")],
    notes: [note("n1", "d1")],
    places: [],
    members: [],
    adminRequests: [],
  };
}

describe("local-trip-store", () => {
  it("does not mutate its input", () => {
    const data = baseData();
    const snapshot = JSON.stringify(data);
    addNote(data, note("n2", "d2"));
    movePhoto(data, "p1", { lat: 1, lng: 2 });
    deleteItem(data, "days", "d1");
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it("prepends notes and appends routes", () => {
    const data = baseData();
    expect(addNote(data, note("n2", "d2")).notes.map((n) => n.id)).toEqual(["n2", "n1"]);
    expect(addRoute(data, route("r2", "d2")).routeSegments.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("prepends photos newest-first", () => {
    const data = baseData();
    const next = prependPhotos(data, [photo("p3", null), photo("p4", null)]);
    expect(next.photos.map((p) => p.id)).toEqual(["p3", "p4", "p1", "p2"]);
  });

  it("patches the trip but leaves a null trip alone", () => {
    const data = baseData();
    expect(patchTrip(data, { title: "Renamed" }).trip?.title).toBe("Renamed");
    expect(patchTrip({ ...data, trip: null }, { title: "x" }).trip).toBeNull();
  });

  it("keeps days ordered by day_number on add and patch", () => {
    const data = baseData();
    expect(addDay(data, day("d0", 0)).days.map((d) => d.id)).toEqual(["d0", "d1", "d2"]);
    // Renumbering d1 above d2 should re-sort the list.
    expect(patchDay(data, "d1", { day_number: 5 }).days.map((d) => d.id)).toEqual(["d2", "d1"]);
  });

  it("moves a photo to a new coordinate", () => {
    const moved = movePhoto(baseData(), "p1", { lat: 70, lng: 15 });
    const target = moved.photos.find((p) => p.id === "p1");
    expect([target?.lat, target?.lng]).toEqual([70, 15]);
  });

  it("deleting a day orphans its children across every table", () => {
    const { data } = deleteItem(baseData(), "days", "d1");
    expect(data.days.map((d) => d.id)).toEqual(["d2"]);
    // d1's children survive but become unassigned; d2's are untouched.
    expect(data.photos.find((p) => p.id === "p1")?.day_id).toBeNull();
    expect(data.photos.find((p) => p.id === "p2")?.day_id).toBe("d2");
    expect(data.notes.find((n) => n.id === "n1")?.day_id).toBeNull();
    expect(data.routeSegments.find((r) => r.id === "r1")?.day_id).toBeNull();
  });

  it("deleting a non-day row removes only that row and detaches nothing", () => {
    const { data } = deleteItem(baseData(), "notes", "n1");
    expect(data.notes).toHaveLength(0);
    expect(data.photos.find((p) => p.id === "p1")?.day_id).toBe("d1");
    expect(data.days.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("reports blob URLs to revoke when deleting a photo", () => {
    const data = baseData();
    data.photos = [
      photo("p1", "d1", { image_url: "blob:abc", thumbnail_url: "blob:def" }),
      photo("p2", "d2", { image_url: "https://cdn/x.jpg" }),
    ];
    expect(deleteItem(data, "photos", "p1").revokedUrls).toEqual(["blob:abc", "blob:def"]);
    expect(deleteItem(data, "photos", "p2").revokedUrls).toEqual([]);
  });

  it("appends a GPX import (days sorted, notes prepended)", () => {
    const data = baseData();
    const next = appendGpxImport(data, {
      days: [day("d3", 3)],
      routes: [route("r2", "d3")],
      notes: [note("n2", "d3")],
    });
    expect(next.days.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
    expect(next.routeSegments.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(next.notes.map((n) => n.id)).toEqual(["n2", "n1"]);
  });
});
