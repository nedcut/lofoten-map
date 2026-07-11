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

function fakeSupabase(options: { failUploadFor?: string[]; clashHashes?: string[]; legacyClashHashes?: string[]; lateClashHashes?: string[]; clashError?: string; recheckError?: string; insertErrorMessage?: string; insertThrows?: string } = {}) {
  const uploaded: string[] = [];
  let clashQueries = 0;
  const upserted: boolean[] = [];
  const removed: string[] = [];
  const inserted: Array<Record<string, unknown>> = [];
  const client = {
    storage: {
      from: () => ({
        upload: async (path: string, file: File, uploadOptions?: { upsert?: boolean }) => {
          if (options.failUploadFor?.some((name) => file.name.startsWith(name))) return { error: { message: "storage exploded" } };
          uploaded.push(path);
          upserted.push(Boolean(uploadOptions?.upsert));
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
          in: async () => {
            clashQueries += 1;
            const errorMessage = clashQueries === 1 ? options.clashError : options.recheckError;
            if (errorMessage) return { data: null, error: { message: errorMessage } };
            const hashes = [
              ...(options.clashHashes ?? []),
              ...(options.legacyClashHashes ?? []),
              // Rows a racer inserted between the clash check and the insert:
              // visible only from the second (post-failure) query onward.
              ...(clashQueries > 1 ? options.lateClashHashes ?? [] : []),
            ];
            return {
              data: hashes.map((hash) => ({
                content_hash: hash,
                image_path: options.legacyClashHashes?.includes(hash) ? `lofoten-2026/legacy-${hash}.mp4` : `lofoten-2026/${hash}.mp4`,
                thumbnail_path: null,
              })),
              error: null,
            };
          },
        }),
      }),
      insert: (rows: Array<Record<string, unknown>>) => ({
        select: async () => {
          if (options.insertThrows) throw new Error(options.insertThrows);
          if (options.insertErrorMessage) return { data: null, error: { message: options.insertErrorMessage } };
          inserted.push(...rows);
          const returned = rows.map((row, index) => ({ ...row, id: `row-${index}` }));
          return { data: returned, error: null };
        },
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, uploaded, upserted, removed, inserted };
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
    expect(result.insertedRows).toHaveLength(2);
    expect(result.insertedRows[0].id).toBe("row-0");
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

  // New rows are content-addressed, so a racing upload of an already-stored hash
  // lands on the live row's exact key. Removing it would strand that row.
  it("leaves storage alone for hashes someone else uploaded mid-batch", async () => {
    const { client, removed, inserted } = fakeSupabase({ clashHashes: ["hash-a"] });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.savedClientIds).toEqual(["b"]);
    expect(removed).toEqual([]);
    expect(inserted).toHaveLength(1);
  });

  it("removes an unused hash-path upload when the clashing row has a legacy UUID path", async () => {
    const { client, removed, inserted } = fakeSupabase({ legacyClashHashes: ["hash-a"] });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.savedClientIds).toEqual(["b"]);
    expect(removed).toEqual(["lofoten-2026/hash-a.mp4"]);
    expect(inserted).toHaveLength(1);
  });

  it("does not clean up live objects when the clash check fails", async () => {
    const { client, removed } = fakeSupabase({ clashError: "clash lookup failed" });
    const { result } = await batch(client, [input({ clientId: "a" })]);

    expect(result.insertErrorMessage).toBe("clash lookup failed");
    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.inserted).toBe(false);
    expect(removed).toEqual([]);
  });

  it("keys objects by content hash and upserts, so a retry overwrites instead of orphaning", async () => {
    const first = fakeSupabase();
    await batch(first.client, [input({ clientId: "a" })]);
    // Same file, second attempt: a batch that died before its insert last time.
    const second = fakeSupabase();
    await batch(second.client, [input({ clientId: "a" })]);

    expect(first.uploaded).toEqual(["lofoten-2026/hash-a.mp4"]);
    expect(second.uploaded).toEqual(first.uploaded);
    expect(first.upserted).toEqual([true]);
  });

  it("rolls back only the fresh objects when the insert fails", async () => {
    const { client, removed } = fakeSupabase({ clashHashes: ["hash-a"], insertErrorMessage: "insert exploded" });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.insertErrorMessage).toBe("insert exploded");
    // b's object is unreferenced and goes; a's is the existing row's own object.
    expect(removed).toEqual(["lofoten-2026/hash-b.mp4"]);
    expect(result.savedClientIds).toEqual([]);
  });

  it("spares objects a racing insert claimed when the unique index rejects the batch", async () => {
    const { client, removed } = fakeSupabase({ lateClashHashes: ["hash-a"], insertErrorMessage: "unique constraint" });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.insertErrorMessage).toBe("unique constraint");
    // hash-a gained a row mid-window, and that row references our own
    // content-addressed objects; only hash-b's object is truly unreferenced.
    expect(removed).toEqual(["lofoten-2026/hash-b.mp4"]);
  });

  it("skips rollback cleanup when the post-failure re-check fails", async () => {
    const { client, removed } = fakeSupabase({ insertErrorMessage: "insert exploded", recheckError: "recheck down" });
    const { result } = await batch(client, [input({ clientId: "a" })]);

    expect(result.insertErrorMessage).toBe("insert exploded");
    expect(removed).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("recheck down"))).toBe(true);
  });

  it("leaves uploads in place when the insert throws", async () => {
    const { client, removed, uploaded } = fakeSupabase({ insertThrows: "network died" });
    const { result } = await batch(client, [input({ clientId: "a" })]);

    expect(result.insertErrorMessage).toBe("network died");
    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.inserted).toBe(false);
    // Which hashes gained a row is unknown here, so blind cleanup could delete a
    // live object. The content-addressed key is reused by the retry instead.
    expect(uploaded).toEqual(["lofoten-2026/hash-a.mp4"]);
    expect(removed).toEqual([]);
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
