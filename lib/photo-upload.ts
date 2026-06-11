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
 * removed again whenever their row cannot be inserted, so a failure never
 * leaves orphaned files behind.
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
  const uploadedPaths: string[] = [];
  const savedClientIds: string[] = [];
  const failedClientIds: string[] = [];
  let insertErrorMessage: string | null = null;
  let inserted = false;
  let insertedRows: Photo[] = [];

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
    const path = `${trip.slug}/${crypto.randomUUID()}.${extension}`;
    const thumbnailPath = prepared.thumbnailFile ? `${trip.slug}/thumbs/${crypto.randomUUID()}.jpg` : null;
    // The thumbnail never depends on the image upload, so both go up
    // together instead of back to back.
    const [imageUpload, thumbnailUpload] = await Promise.all([
      supabase.storage.from(PHOTO_BUCKET).upload(path, prepared.imageFile, { cacheControl: IMMUTABLE_CACHE_SECONDS, upsert: false, contentType: prepared.imageFile.type || undefined }),
      prepared.thumbnailFile && thumbnailPath
        ? supabase.storage.from(PHOTO_BUCKET).upload(thumbnailPath, prepared.thumbnailFile, { cacheControl: IMMUTABLE_CACHE_SECONDS, upsert: false, contentType: prepared.thumbnailFile.type })
        : Promise.resolve(null),
    ]);
    if (imageUpload.error) {
      if (thumbnailPath && thumbnailUpload && !thumbnailUpload.error) await supabase.storage.from(PHOTO_BUCKET).remove([thumbnailPath]);
      failures.push(`${input.file.name}: ${imageUpload.error.message}`);
      failedClientIds.push(input.clientId);
      onItemComplete();
      return;
    }
    uploadedPaths.push(path);
    let thumbnailStoragePath: string | null = null;
    if (thumbnailUpload) {
      if (thumbnailUpload.error) {
        warnings.push(`${input.file.name}: thumbnail skipped`);
      } else if (thumbnailPath) {
        uploadedPaths.push(thumbnailPath);
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
    // Re-check hashes against the database rather than local state, so a
    // photo someone else uploaded mid-batch is skipped instead of failing
    // the whole insert on the unique index.
    const { data: clashData } = await supabase.from("photos").select("content_hash").eq("trip_id", trip.id).in("content_hash", rows.map((row) => row.content_hash));
    const clashes = new Set(((clashData ?? []) as Array<{ content_hash: string }>).map((row) => row.content_hash));
    const clashedRows = rows.filter((row) => clashes.has(row.content_hash));
    const freshRows = rows.filter((row) => !clashes.has(row.content_hash));
    if (clashedRows.length > 0) {
      await supabase.storage.from(PHOTO_BUCKET).remove(clashedRows.flatMap((row) => [row.image_path, row.thumbnail_path].filter((rowPath): rowPath is string => Boolean(rowPath))));
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
        if (uploadedPaths.length > 0) await supabase.storage.from(PHOTO_BUCKET).remove(uploadedPaths);
        insertErrorMessage = insertError.message;
        failedClientIds.push(...freshRows.map((row) => row.client_id));
      } else {
        savedClientIds.push(...freshRows.map((row) => row.client_id));
        inserted = true;
        insertedRows = (returnedRows ?? []) as Photo[];
      }
    }
  }

  return { savedClientIds, failedClientIds, failures, warnings, uploadedCount: rows.length, insertErrorMessage, inserted, insertedRows };
}
