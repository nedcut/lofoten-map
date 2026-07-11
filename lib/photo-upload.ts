import type { SupabaseClient } from "@supabase/supabase-js";
import { mapWithConcurrency } from "./concurrency";
import { prepareMediaFiles, storageFileExtension } from "./media-processing";
import { partitionDuplicatePhotos } from "./photo-dedup";
import { IMMUTABLE_CACHE_SECONDS, PHOTO_BUCKET } from "./supabase";
import type { LngLat, Photo } from "@/types/trip";

export type PhotoBatchInput = {
  clientId: string;
  file: File;
  mediaType: "photo" | "video";
  contentHash: string;
  caption: string;
  dayId: string | null;
  coordinate: LngLat;
  exif: { takenAt: string | null; exifFound: boolean } | null;
};

export type PhotoBatchOutcome = {
  savedClientIds: string[];
  failedClientIds: string[];
  /** Per-item failure descriptions, e.g. "IMG_1.jpg: duplicate media skipped". */
  failures: string[];
  /** Non-fatal issues, e.g. a thumbnail that could not be stored. */
  warnings: string[];
  /** How many items made it through the storage-upload stage. */
  uploadedCount: number;
  /** Message from a failed database insert; storage objects are rolled back. */
  insertErrorMessage: string | null;
  /** True when at least one row was inserted into the photos table. */
  inserted: boolean;
  /**
   * The inserted rows as returned by the database, so the caller can patch
   * them into local state instead of refetching every table.
   */
  insertedRows: Photo[];
};

type PendingRow = {
  client_id: string;
  trip_id: string;
  day_id: string | null;
  uploader_name: string;
  content_hash: string;
  media_type: "photo" | "video";
  image_path: string;
  thumbnail_path: string | null;
  lat: number;
  lng: number;
  taken_at: string | null | undefined;
  caption: string;
  exif_found: boolean;
};

/**
 * Upload a batch of media files to Supabase Storage and insert their rows.
 *
 * Stages: skip duplicates already in `existingPhotos`, upload image +
 * thumbnail concurrently per item (bounded by `concurrency`), re-check
 * content hashes against the database (someone else may have uploaded the
 * same photo mid-batch), then insert the surviving rows. Storage objects are
 * removed again when it is safe to prove that their row was not inserted.
 * If the database outcome is unknown, content-addressed paths let a retry
 * reuse the same objects instead of creating another abandoned copy.
 *
 * Pure orchestration over the injected client — UI state (error banners,
 * reloads, panel close) stays with the caller, driven by the outcome.
 */
export async function uploadPhotoBatch(options: {
  supabase: SupabaseClient;
  trip: { id: string; slug: string };
  existingPhotos: Photo[];
  uploaderName: string;
  inputs: PhotoBatchInput[];
  concurrency: number;
  onItemComplete: () => void;
}): Promise<PhotoBatchOutcome> {
  const { supabase, trip, existingPhotos, uploaderName, inputs, concurrency, onItemComplete } = options;
  const rows: PendingRow[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];
  const savedClientIds: string[] = [];
  const failedClientIds: string[] = [];
  let insertErrorMessage: string | null = null;
  let inserted = false;
  let insertedRows: Photo[] = [];

  const storagePathsOf = (pending: PendingRow[]) =>
    pending.flatMap((row) => [row.image_path, row.thumbnail_path].filter((path): path is string => Boolean(path)));

  // A cleanup that silently fails is how the bucket filled up with unreachable
  // objects in the first place, so a failed removal is reported, not dropped.
  const removeObjects = async (paths: string[], label: string) => {
    if (paths.length === 0) return;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
    if (error) warnings.push(`${label}: storage cleanup failed (${error.message})`);
  };

  const { uploads: uploadCandidates, duplicates } = partitionDuplicatePhotos(
    inputs.map((input) => ({ input, contentHash: input.contentHash, mediaType: input.mediaType, takenAt: input.exif?.takenAt ?? null, coordinate: input.coordinate })),
    existingPhotos,
  );
  for (const duplicate of duplicates) {
    failures.push(`${duplicate.input.file.name}: duplicate media skipped`);
    failedClientIds.push(duplicate.input.clientId);
    onItemComplete();
  }

  await mapWithConcurrency(uploadCandidates.map((candidate) => candidate.input), concurrency, async (input) => {
    const prepared = await prepareMediaFiles(input.file);
    const extension = storageFileExtension(prepared.imageFile);
    // Content-addressed, so an upload is idempotent: a retry of a batch that
    // died before its insert lands on the same key and overwrites the object
    // instead of stranding it under a fresh uuid. `(trip_id, content_hash)` is
    // already unique in the database, so one key here is one row there.
    const path = `${trip.slug}/${input.contentHash}.${extension}`;
    const thumbnailPath = prepared.thumbnailFile ? `${trip.slug}/thumbs/${input.contentHash}.jpg` : null;
    // The thumbnail never depends on the image upload, so both go up
    // together instead of back to back.
    const [imageUpload, thumbnailUpload] = await Promise.all([
      supabase.storage.from(PHOTO_BUCKET).upload(path, prepared.imageFile, { cacheControl: IMMUTABLE_CACHE_SECONDS, upsert: true, contentType: prepared.imageFile.type || undefined }),
      prepared.thumbnailFile && thumbnailPath
        ? supabase.storage.from(PHOTO_BUCKET).upload(thumbnailPath, prepared.thumbnailFile, { cacheControl: IMMUTABLE_CACHE_SECONDS, upsert: true, contentType: prepared.thumbnailFile.type })
        : Promise.resolve(null),
    ]);
    if (imageUpload.error) {
      if (thumbnailPath && thumbnailUpload && !thumbnailUpload.error) await removeObjects([thumbnailPath], input.file.name);
      failures.push(`${input.file.name}: ${imageUpload.error.message}`);
      failedClientIds.push(input.clientId);
      onItemComplete();
      return;
    }
    let thumbnailStoragePath: string | null = null;
    if (thumbnailUpload) {
      if (thumbnailUpload.error) {
        warnings.push(`${input.file.name}: thumbnail skipped`);
      } else if (thumbnailPath) {
        thumbnailStoragePath = thumbnailPath;
      }
    }
    rows.push({
      client_id: input.clientId,
      trip_id: trip.id,
      day_id: input.dayId,
      uploader_name: uploaderName,
      content_hash: input.contentHash,
      media_type: input.mediaType,
      image_path: path,
      thumbnail_path: thumbnailStoragePath,
      lat: input.coordinate.lat,
      lng: input.coordinate.lng,
      taken_at: input.exif?.takenAt,
      caption: input.caption,
      exif_found: input.exif?.exifFound ?? false,
    });
    onItemComplete();
  });

  if (rows.length > 0) {
    try {
      // Re-check hashes against the database rather than local state, so a
      // photo someone else uploaded mid-batch is skipped instead of failing
      // the whole insert on the unique index.
      const { data: clashData, error: clashError } = await supabase
        .from("photos")
        .select("content_hash,image_path,thumbnail_path")
        .eq("trip_id", trip.id)
        .in("content_hash", rows.map((row) => row.content_hash));
      if (clashError) throw clashError;
      const clashes = new Map(
        ((clashData ?? []) as Array<{ content_hash: string; image_path: string; thumbnail_path: string | null }>).map((row) => [row.content_hash, row]),
      );
      const clashedRows = rows.filter((row) => clashes.has(row.content_hash));
      const freshRows = rows.filter((row) => !clashes.has(row.content_hash));
      if (clashedRows.length > 0) {
        // New rows already use hash paths, so a racing upload normally lands on
        // the live row's own objects and must not remove them. Legacy rows still
        // use UUID paths, though; in that case the hash-path uploads are unused
        // and can be removed without touching the legacy row's objects.
        const unusedClashPaths = clashedRows.flatMap((row) => {
          const existing = clashes.get(row.content_hash)!;
          return [row.image_path, row.thumbnail_path].filter(
            (path): path is string => Boolean(path) && path !== existing.image_path && path !== existing.thumbnail_path,
          );
        });
        await removeObjects(unusedClashPaths, "duplicate cleanup");
        failures.push(`${clashedRows.length} media item${clashedRows.length === 1 ? "" : "s"} already uploaded by someone else, skipped`);
        failedClientIds.push(...clashedRows.map((row) => row.client_id));
      }
      const insertRows = freshRows.map((row) => ({
        trip_id: row.trip_id,
        day_id: row.day_id,
        uploader_name: row.uploader_name,
        content_hash: row.content_hash,
        media_type: row.media_type,
        image_path: row.image_path,
        thumbnail_path: row.thumbnail_path,
        lat: row.lat,
        lng: row.lng,
        taken_at: row.taken_at,
        caption: row.caption,
        exif_found: row.exif_found,
      }));
      if (insertRows.length > 0) {
        const { data: returnedRows, error: insertError } = await supabase.from("photos").insert(insertRows).select();
        if (insertError) {
          // The likely insert error is the unique index: a racer inserted one
          // of these hashes after the clash check above, and that row now
          // references our content-addressed paths. Re-check which hashes
          // gained rows and remove only the paths nothing references.
          const { data: recheckData, error: recheckError } = await supabase
            .from("photos")
            .select("content_hash,image_path,thumbnail_path")
            .eq("trip_id", trip.id)
            .in("content_hash", freshRows.map((row) => row.content_hash));
          if (recheckError) {
            warnings.push(`rollback: skipped storage cleanup, could not confirm the objects are unreferenced (${recheckError.message})`);
          } else {
            const referencedPaths = new Set(
              ((recheckData ?? []) as Array<{ image_path: string; thumbnail_path: string | null }>).flatMap((row) =>
                [row.image_path, row.thumbnail_path].filter((path): path is string => Boolean(path)),
              ),
            );
            await removeObjects(storagePathsOf(freshRows).filter((path) => !referencedPaths.has(path)), "rollback");
          }
          insertErrorMessage = insertError.message;
          failedClientIds.push(...freshRows.map((row) => row.client_id));
        } else {
          savedClientIds.push(...freshRows.map((row) => row.client_id));
          inserted = true;
          insertedRows = (returnedRows ?? []) as Photo[];
        }
      }
    } catch (error) {
      // The clash check or the insert threw, so which hashes have rows is now
      // unknown and blind cleanup could delete a live object. The uploads are
      // content-addressed, so they sit on the keys a retry of this same batch
      // will overwrite -- abandoning them costs one object each, not one per
      // attempt. scripts/purge-orphan-objects.mjs sweeps any never retried.
      insertErrorMessage = error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
          ? error.message
          : "Could not save uploaded media.";
      failedClientIds.push(...rows.map((row) => row.client_id));
    }
  }

  return { savedClientIds, failedClientIds, failures, warnings, uploadedCount: rows.length, insertErrorMessage, inserted, insertedRows };
}
