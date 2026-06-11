import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadPhotoBatch, type PhotoBatchInput } from "./photo-upload";
import type { Photo } from "@/types/trip";

// Video inputs pass through prepareMediaFiles untouched in the node test
// environment (no canvas, no thumbnail), which keeps storage paths and
// upload counts deterministic.
function input(overrides: Partial<PhotoBatchInput> = {}): PhotoBatchInput {
  const name = overrides.clientId ?? "a";
  return {
    clientId: name,
    file: new File([new Uint8Array([1, 2, 3])], `${name}.mp4`, { type: "video/mp4" }),
    mediaType: "video",
    contentHash: `hash-${name}`,
    caption: "",
    dayId: null,
    coordinate: { lng: 13.0, lat: 67.9 },
    exif: { takenAt: null, exifFound: false },
    ...overrides,
  };
}

function existingPhoto(contentHash: string): Photo {
  return {
    id: "existing",
    trip_id: "trip-1",
    day_id: null,
    user_id: null,
    uploader_name: "Friend",
    content_hash: contentHash,
    media_type: "video",
    image_path: "lofoten/existing.mp4",
    thumbnail_path: null,
    image_url: null,
    thumbnail_url: null,
    lat: null,
    lng: null,
    taken_at: null,
    caption: null,
    exif_found: false,
    created_at: "2026-05-28T08:00:00Z",
  };
}

function fakeSupabase(options: { failUploadFor?: string[]; clashHashes?: string[]; insertErrorMessage?: string } = {}) {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const inserted: Array<Record<string, unknown>> = [];
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, file: File) => {
          if (options.failUploadFor?.some((name) => file.name.startsWith(name))) return { error: { message: "storage exploded" } };
          uploaded.push(path);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          removed.push(...paths);
          return { error: null };
        },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: (options.clashHashes ?? []).map((hash) => ({ content_hash: hash })) }),
        }),
      }),
      insert: async (rows: Array<Record<string, unknown>>) => {
        if (options.insertErrorMessage) return { error: { message: options.insertErrorMessage } };
        inserted.push(...rows);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, uploaded, removed, inserted };
}

const trip = { id: "trip-1", slug: "lofoten-2026" };

function batch(client: SupabaseClient, inputs: PhotoBatchInput[], existingPhotos: Photo[] = []) {
  let progressCalls = 0;
  const outcome = uploadPhotoBatch({
    supabase: client,
    trip,
    existingPhotos,
    uploaderName: "Ned",
    inputs,
    concurrency: 2,
    onItemComplete: () => {
      progressCalls += 1;
    },
  });
  return outcome.then((result) => ({ result, progressCalls: () => progressCalls }));
}

describe("uploadPhotoBatch", () => {
  it("uploads and inserts every fresh item, reporting progress per item", async () => {
    const { client, uploaded, inserted } = fakeSupabase();
    const { result, progressCalls } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.savedClientIds.sort()).toEqual(["a", "b"]);
    expect(result.failedClientIds).toEqual([]);
    expect(result.inserted).toBe(true);
    expect(progressCalls()).toBe(2);
    expect(uploaded).toHaveLength(2);
    expect(uploaded.every((path) => path.startsWith("lofoten-2026/") && path.endsWith(".mp4"))).toBe(true);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).not.toHaveProperty("client_id");
    expect(inserted[0]).toMatchObject({ trip_id: "trip-1", uploader_name: "Ned", media_type: "video" });
  });

  it("skips items that duplicate existing photos without touching storage", async () => {
    const { client, uploaded } = fakeSupabase();
    const { result, progressCalls } = await batch(client, [input({ clientId: "a" })], [existingPhoto("hash-a")]);

    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.failures).toEqual(["a.mp4: duplicate media skipped"]);
    expect(result.inserted).toBe(false);
    expect(progressCalls()).toBe(1);
    expect(uploaded).toEqual([]);
  });

  it("records a failure for a broken upload but still saves the rest", async () => {
    const { client, inserted } = fakeSupabase({ failUploadFor: ["a"] });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.failures).toEqual(["a.mp4: storage exploded"]);
    expect(result.savedClientIds).toEqual(["b"]);
    expect(inserted).toHaveLength(1);
  });

  it("removes storage objects for hashes someone else uploaded mid-batch", async () => {
    const { client, removed, inserted } = fakeSupabase({ clashHashes: ["hash-a"] });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.savedClientIds).toEqual(["b"]);
    expect(removed).toHaveLength(1);
    expect(inserted).toHaveLength(1);
  });

  it("rolls back every uploaded object when the insert fails", async () => {
    const { client, removed, inserted } = fakeSupabase({ insertErrorMessage: "unique constraint" });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.insertErrorMessage).toBe("unique constraint");
    expect(result.inserted).toBe(false);
    expect(result.failedClientIds.sort()).toEqual(["a", "b"]);
    expect(removed).toHaveLength(2);
    expect(inserted).toEqual([]);
  });
});
