import { describe, expect, it } from "vitest";
import { applyRealtimeChange } from "./realtime-patch";
import { demoTripData } from "./demo-trip";
import type { Note, Photo } from "@/types/trip";

describe("applyRealtimeChange", () => {
  it("inserts a new note without refetching", () => {
    const note: Note = {
      id: "note-new",
      trip_id: demoTripData.trip!.id,
      day_id: null,
      user_id: "user-1",
      author_name: "Alex",
      lat: 67.9,
      lng: 13.0,
      body: "Fresh note",
      note_type: "note",
      created_at: "2026-07-12T12:00:00.000Z",
    };
    const next = applyRealtimeChange(demoTripData, "notes", { eventType: "INSERT", new: note, old: {} }, null);
    expect(next.notes[0]).toEqual(note);
    expect(next.notes).toHaveLength(demoTripData.notes.length + 1);
  });

  it("updates an existing photo in place", () => {
    const photo: Photo = {
      id: "photo-1",
      trip_id: demoTripData.trip!.id,
      day_id: null,
      user_id: null,
      uploader_name: "Maja",
      content_hash: "hash-1",
      media_type: "photo",
      image_path: "lofoten/a.jpg",
      thumbnail_path: null,
      image_url: null,
      thumbnail_url: null,
      lat: 67.9,
      lng: 13.0,
      taken_at: null,
      caption: "Updated caption",
      exif_found: true,
      created_at: "2026-07-12T12:00:00.000Z",
    };
    const seeded = { ...demoTripData, photos: [photo] };
    const next = applyRealtimeChange(seeded, "photos", { eventType: "UPDATE", new: { ...photo, caption: "New caption" }, old: photo }, null);
    expect(next.photos[0]?.caption).toBe("New caption");
  });

  it("removes a note on delete", () => {
    const note = demoTripData.notes[0]!;
    const next = applyRealtimeChange(demoTripData, "notes", { eventType: "DELETE", new: {}, old: note }, null);
    expect(next.notes).toHaveLength(0);
  });
});
