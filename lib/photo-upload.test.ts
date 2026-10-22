import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendClient } from "@/lib/backend";
import type { PreparedMediaFiles } from "./media-processing";
import { uploadPhotoBatch, type PhotoBatchInput } from "./photo-upload";
import type { Photo } from "@/types/trip";

// Browser-only renditions (thumbnail, marker) cannot be produced under node,
// so tests that need them swap in prepared files here.
const preparation = vi.hoisted(() => ({ override: null as null | ((file: File) => PreparedMediaFiles) }));
vi.mock("./media-processing", async () => {
  const actual = await vi.importActual<typeof import("./media-processing")>("./media-processing");
  return {
    ...actual,
    prepareMediaFiles: (file: File) => preparation.override ? Promise.resolve(preparation.override(file)) : actual.prepareMediaFiles(file),
  };
});

afterEach(() => {
  preparation.override = null;
  vi.unstubAllGlobals();
});

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

function fakeBackend(options: { failUploadFor?: string[]; existingUploadFor?: string[]; clashHashes?: string[]; legacyClashHashes?: string[]; lateClashHashes?: string[]; clashError?: string; recheckError?: string; insertErrorMessage?: string; insertThrows?: string } = {}) {
  const uploaded: string[] = [];
  let clashQueries = 0;
  const upserted: boolean[] = [];
  const removed: string[] = [];
  const inserted: Array<Record<string, unknown>> = [];
  const objectStore = {
    upload: async (path: string, file: Blob) => {
      const namedFile = file as File;
      if (options.failUploadFor?.some((name) => namedFile.name.startsWith(name))) return { error: { message: "storage exploded" } };
      if (options.existingUploadFor?.some((name) => namedFile.name.startsWith(name))) return { error: { message: "The resource already exists", statusCode: "409" } };
      uploaded.push(path);
      upserted.push(false);
      return { error: null };
    },
    remove: async (paths: string[]) => {
      removed.push(...paths);
      return { error: null };
    },
  };
  const client = {
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
    __objectStore: objectStore,
  } as unknown as BackendClient & { __objectStore: typeof objectStore };
  return { client, uploaded, upserted, removed, inserted };
}

const trip = { id: "trip-1", slug: "lofoten-2026" };

function batch(client: BackendClient & { __objectStore: ReturnType<typeof fakeBackend>["client"]["__objectStore"] }, inputs: PhotoBatchInput[], existingPhotos: Photo[] = []) {
  let progressCalls = 0;
  const outcome = uploadPhotoBatch({
    backend: client,
    trip,
    existingPhotos,
    uploaderName: "Ned",
    inputs,
    concurrency: 2,
    onItemComplete: () => {
      progressCalls += 1;
    },
    objectStore: client.__objectStore,
  });
  return outcome.then((result) => ({ result, progressCalls: () => progressCalls }));
}

describe("uploadPhotoBatch", () => {
  it("uploads and inserts every fresh item, reporting progress per item", async () => {
    const { client, uploaded, inserted } = fakeBackend();
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

  it.each(["null", "throw"])("reports HEIC encoder %s failures per item and continues the batch", async (failure) => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1200, height: 800, close }));
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob(callback: BlobCallback) {
          if (failure === "throw") throw new Error("encoder failed");
          callback(null);
        },
      }),
    });
    const { client, uploaded, inserted } = fakeBackend();
    const { result, progressCalls } = await batch(client, [
      input({ clientId: "bad", mediaType: "photo", file: new File([new Uint8Array([1])], "fjord.HEIC", { type: "" }) }),
      input({ clientId: "good", mediaType: "photo", file: new File([new Uint8Array([2])], "ridge.jpg", { type: "image/jpeg" }) }),
    ]);

    expect(result.failedClientIds).toEqual(["bad"]);
    expect(result.failures).toEqual(["fjord.HEIC: Could not convert HEIC/HEIF to JPEG. Export it as JPEG and try again."]);
    expect(result.savedClientIds).toEqual(["good"]);
    expect(uploaded).toEqual(["lofoten-2026/hash-good.jpg"]);
    expect(inserted).toHaveLength(1);
    expect(progressCalls()).toBe(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("skips items that duplicate existing photos without touching storage", async () => {
    const { client, uploaded } = fakeBackend();
    const { result, progressCalls } = await batch(client, [input({ clientId: "a" })], [existingPhoto("hash-a")]);

    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.failures).toEqual(["a.mp4: duplicate media skipped"]);
    expect(result.inserted).toBe(false);
    expect(progressCalls()).toBe(1);
    expect(uploaded).toEqual([]);
  });

  it("records a failure for a broken upload but still saves the rest", async () => {
    const { client, inserted } = fakeBackend({ failUploadFor: ["a"] });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.failures).toEqual(["a.mp4: storage exploded"]);
    expect(result.savedClientIds).toEqual(["b"]);
    expect(inserted).toHaveLength(1);
  });

  // New rows are content-addressed, so a racing upload of an already-stored hash
  // lands on the live row's exact key. Removing it would strand that row.
  it("leaves storage alone for hashes someone else uploaded mid-batch", async () => {
    const { client, removed, inserted } = fakeBackend({ clashHashes: ["hash-a"] });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.savedClientIds).toEqual(["b"]);
    expect(removed).toEqual([]);
    expect(inserted).toHaveLength(1);
  });

  it("removes an unused hash-path upload when the clashing row has a legacy UUID path", async () => {
    const { client, removed, inserted } = fakeBackend({ legacyClashHashes: ["hash-a"] });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.savedClientIds).toEqual(["b"]);
    expect(removed).toEqual(["lofoten-2026/hash-a.mp4"]);
    expect(inserted).toHaveLength(1);
  });

  it("does not clean up live objects when the clash check fails", async () => {
    const { client, removed } = fakeBackend({ clashError: "clash lookup failed" });
    const { result } = await batch(client, [input({ clientId: "a" })]);

    expect(result.insertErrorMessage).toBe("clash lookup failed");
    expect(result.failedClientIds).toEqual(["a"]);
    expect(result.inserted).toBe(false);
    expect(removed).toEqual([]);
  });

  it("keys objects by content hash without overwriting immutable objects", async () => {
    const first = fakeBackend();
    await batch(first.client, [input({ clientId: "a" })]);
    // Same file, second attempt: a batch that died before its insert last time.
    const second = fakeBackend();
    await batch(second.client, [input({ clientId: "a" })]);

    expect(first.uploaded).toEqual(["lofoten-2026/hash-a.mp4"]);
    expect(second.uploaded).toEqual(first.uploaded);
    expect(first.upserted).toEqual([false]);
  });

  it("reuses an immutable object left by an earlier unknown-outcome attempt", async () => {
    const { client, inserted } = fakeBackend({ existingUploadFor: ["a.jpg"] });
    const { result } = await batch(client, [input({ clientId: "a" })]);

    expect(result.savedClientIds).toEqual(["a"]);
    expect(inserted).toHaveLength(1);
  });

  it("rolls back only the fresh objects when the insert fails", async () => {
    const { client, removed } = fakeBackend({ clashHashes: ["hash-a"], insertErrorMessage: "insert exploded" });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.insertErrorMessage).toBe("insert exploded");
    // b's object is unreferenced and goes; a's is the existing row's own object.
    expect(removed).toEqual(["lofoten-2026/hash-b.mp4"]);
    expect(result.savedClientIds).toEqual([]);
  });

  it("spares objects a racing insert claimed when the unique index rejects the batch", async () => {
    const { client, removed } = fakeBackend({ lateClashHashes: ["hash-a"], insertErrorMessage: "unique constraint" });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.insertErrorMessage).toBe("unique constraint");
    // hash-a gained a row mid-window, and that row references our own
    // content-addressed objects; only hash-b's object is truly unreferenced.
    expect(removed).toEqual(["lofoten-2026/hash-b.mp4"]);
  });

  it("skips rollback cleanup when the post-failure re-check fails", async () => {
    const { client, removed } = fakeBackend({ insertErrorMessage: "insert exploded", recheckError: "recheck down" });
    const { result } = await batch(client, [input({ clientId: "a" })]);

    expect(result.insertErrorMessage).toBe("insert exploded");
    expect(removed).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("recheck down"))).toBe(true);
  });

  it("leaves uploads in place when the insert throws", async () => {
    const { client, removed, uploaded } = fakeBackend({ insertThrows: "network died" });
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
    const { client, removed, inserted } = fakeBackend({ insertErrorMessage: "unique constraint" });
    const { result } = await batch(client, [input({ clientId: "a" }), input({ clientId: "b" })]);

    expect(result.insertErrorMessage).toBe("unique constraint");
    expect(result.inserted).toBe(false);
    expect(result.failedClientIds.sort()).toEqual(["a", "b"]);
    expect(removed).toHaveLength(2);
    expect(inserted).toEqual([]);
  });
});

describe("uploadPhotoBatch map-marker images", () => {
  function withRenditions() {
    preparation.override = (file) => ({
      imageFile: file,
      thumbnailFile: new File([new Uint8Array([4])], `${file.name}-thumb.jpg`, { type: "image/jpeg" }),
      markerFile: new File([new Uint8Array([5])], `${file.name}-marker.jpg`, { type: "image/jpeg" }),
      optimized: false,
      mediaType: "video",
    });
  }

  it("stores the marker beside the thumbnail, at the path markers are read from", async () => {
    withRenditions();
    const { client, uploaded, inserted } = fakeBackend();
    const { result } = await batch(client, [input({ clientId: "a" })]);

    expect(result.savedClientIds).toEqual(["a"]);
    expect(uploaded.sort()).toEqual([
      "lofoten-2026/hash-a.mp4",
      "lofoten-2026/markers/hash-a.jpg",
      "lofoten-2026/thumbs/hash-a.jpg",
    ]);
    // No column for the marker: it is derived from thumbnail_path.
    expect(inserted[0]).toMatchObject({ thumbnail_path: "lofoten-2026/thumbs/hash-a.jpg" });
    expect(inserted[0]).not.toHaveProperty("marker_path");
  });

  it("skips the marker when its thumbnail could not be stored", async () => {
    withRenditions();
    const { client, uploaded } = fakeBackend({ failUploadFor: ["a.mp4-thumb"] });
    const { result } = await batch(client, [input({ clientId: "a" })]);

    expect(result.savedClientIds).toEqual(["a"]);
    expect(uploaded).toEqual(["lofoten-2026/hash-a.mp4"]);
  });

  it("keeps the upload when only the marker fails, with a warning", async () => {
    withRenditions();
    const { client } = fakeBackend({ failUploadFor: ["a.mp4-marker"] });
    const { result } = await batch(client, [input({ clientId: "a" })]);

    expect(result.savedClientIds).toEqual(["a"]);
    expect(result.warnings).toEqual(["a.mp4: map marker image skipped"]);
  });

  it("rolls back the marker with the rest of the row's objects", async () => {
    withRenditions();
    const { client, removed } = fakeBackend({ insertErrorMessage: "insert exploded" });
    await batch(client, [input({ clientId: "a" })]);

    expect(removed.sort()).toEqual([
      "lofoten-2026/hash-a.mp4",
      "lofoten-2026/markers/hash-a.jpg",
      "lofoten-2026/thumbs/hash-a.jpg",
    ]);
  });

  it("sends HEIC under its real content type when the browser reports none", async () => {
    preparation.override = (file) => ({ imageFile: file, thumbnailFile: null, markerFile: null, optimized: false, mediaType: "photo" });
    const contentTypes: Array<string | undefined> = [];
    const { client } = fakeBackend();
    const upload = client.__objectStore.upload;
    client.__objectStore.upload = async (path, file, options?: { contentType?: string }) => {
      contentTypes.push(options?.contentType);
      return upload(path, file);
    };
    await batch(client, [input({ clientId: "a", mediaType: "photo", file: new File([new Uint8Array([1])], "a.HEIC", { type: "" }) })]);

    expect(contentTypes).toEqual(["image/heic"]);
  });
});
