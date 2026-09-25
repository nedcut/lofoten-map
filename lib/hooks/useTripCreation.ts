"use client";

import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BackendClient, BackendUser } from "@/lib/backend";
import { friendlyPersonName } from "@/lib/display-name";
import { routeDistanceMeters, routeGeometry } from "@/lib/geo";
import { addNote, addRoute, prependPhotos } from "@/lib/local-trip-store";
import { prepareMediaFiles } from "@/lib/media-processing";
import { resolvePhotoUrls } from "@/lib/object-store";
import { clearNoteDraft } from "@/lib/offline-drafts";
import { uploadPhotoBatch } from "@/lib/photo-upload";
import { backendPreviewWriteBlock } from "@/lib/preview-read-only";
import type { LngLat, RouteMode, TripData, TripMember } from "@/types/trip";
import type { PhotoUploadItemInput, PhotoUploadProgress, PhotoUploadSaveResult } from "@/components/UploadPhotoPanel";

const UPLOAD_CONCURRENCY = 4;

interface Options {
  backend: BackendClient | null;
  user: BackendUser | null;
  currentMember: TripMember | null;
  isAdmin: boolean;
  data: TripData;
  setData: Dispatch<SetStateAction<TripData>>;
  loadData: () => Promise<void>;
  tripSlug: string;
  /** Map coordinate picked for a new note. */
  pendingCoordinate: LngLat | null;
  /** Points drawn so far for a manual route. */
  routeDraftPoints: LngLat[];
  /** Called after a successful save so the owning panel can close. */
  onSaved: () => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
}

/**
 * Creating new trip content: notes, media batches, and hand-drawn routes.
 * Each save follows the same shape as the edits in useTripMutations: clear the
 * global status, write to the backend or apply a pure local-trip-store
 * transform in demo mode, then close the panel on success. Failures land in
 * the global error pill because these panels have no status area of their own.
 */
export function useTripCreation({
  backend,
  user,
  currentMember,
  isAdmin,
  data,
  setData,
  loadData,
  tripSlug,
  pendingCoordinate,
  routeDraftPoints,
  onSaved,
  setError,
  setNotice,
}: Options) {
  const [saving, setSaving] = useState(false);

  const saveNote = useCallback(async (input: { body: string; authorName: string; dayId: string | null }) => {
    if (!pendingCoordinate || !input.body || !data.trip) return;
    const blocked = backendPreviewWriteBlock(Boolean(backend));
    if (blocked) {
      setError(blocked);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    let didSave = false;
    try {
      const row = { trip_id: data.trip.id, day_id: input.dayId, user_id: user?.id ?? null, author_name: input.authorName || "Friend", lat: pendingCoordinate.lat, lng: pendingCoordinate.lng, body: input.body, note_type: "note" };
      if (backend) {
        if (!user) {
          setError("Sign in before saving notes.");
          return;
        }
        const { error: insertError } = await backend.from("notes").insert(row);
        if (insertError) setError(insertError.message);
        else {
          await loadData();
          didSave = true;
        }
      } else {
        setData((current) => addNote(current, { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }));
        didSave = true;
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save note.");
    } finally {
      setSaving(false);
      if (didSave) {
        clearNoteDraft(tripSlug);
        onSaved();
      }
    }
  }, [backend, data.trip, loadData, onSaved, pendingCoordinate, setData, setError, setNotice, tripSlug, user]);

  const savePhotos = useCallback(async (
    inputs: PhotoUploadItemInput[],
    onProgress: (progress: PhotoUploadProgress) => void,
  ): Promise<PhotoUploadSaveResult | void> => {
    if (inputs.length === 0 || !data.trip) return;
    const blocked = backendPreviewWriteBlock(Boolean(backend));
    if (blocked) {
      setError(blocked);
      return { savedClientIds: [], failedClientIds: inputs.map((input) => input.clientId) };
    }
    const trip = data.trip;
    setSaving(true);
    setError(null);
    setNotice(null);
    // Uploader is the signed-in user — no name field needed in the upload flow.
    // friendlyPersonName keeps the stored byline from being a raw email when
    // the member never set a display name (reads are public).
    const uploaderName = currentMember?.display_name || friendlyPersonName(user?.email) || "Friend";
    let didSave = false;
    const savedClientIds: string[] = [];
    const failedClientIds: string[] = [];
    let completedUploads = 0;
    const markUploadComplete = () => {
      completedUploads += 1;
      onProgress({ completed: completedUploads, total: inputs.length });
    };
    try {
      if (!backend) {
        const rows = await Promise.all(inputs.map(async (input) => {
          const prepared = await prepareMediaFiles(input.file);
          const row = {
            id: crypto.randomUUID(),
            trip_id: trip.id,
            day_id: input.dayId,
            user_id: user?.id ?? null,
            uploader_name: uploaderName,
            content_hash: input.contentHash,
            media_type: input.mediaType,
            // Demo mode has no object store: preview straight from local blob
            // URLs and leave the storage paths empty (never read in this branch).
            image_path: "",
            thumbnail_path: null,
            image_url: URL.createObjectURL(prepared.imageFile),
            thumbnail_url: prepared.thumbnailFile ? URL.createObjectURL(prepared.thumbnailFile) : null,
            lat: input.coordinate.lat,
            lng: input.coordinate.lng,
            taken_at: input.exif?.takenAt ?? null,
            caption: input.caption,
            exif_found: input.exif?.exifFound ?? false,
            created_at: new Date().toISOString(),
          };
          markUploadComplete();
          return row;
        }));
        setData((current) => prependPhotos(current, rows));
        savedClientIds.push(...inputs.map((input) => input.clientId));
        didSave = true;
      } else {
        if (!user) {
          setError("Sign in before uploading media.");
          return;
        }
        const outcome = await uploadPhotoBatch({
          backend,
          trip: { id: trip.id, slug: trip.slug },
          existingPhotos: data.photos,
          uploaderName,
          inputs,
          concurrency: UPLOAD_CONCURRENCY,
          onItemComplete: markUploadComplete,
        });
        savedClientIds.push(...outcome.savedClientIds);
        failedClientIds.push(...outcome.failedClientIds);
        if (outcome.insertErrorMessage) setError(outcome.insertErrorMessage);
        if (outcome.inserted) {
          // Patch the returned rows into local state instead of refetching
          // every table; the next poll upserts by id, so the two paths
          // converge instead of duplicating.
          const resolved = resolvePhotoUrls(outcome.insertedRows);
          const insertedIds = new Set(resolved.map((row) => row.id));
          setData((current) => ({ ...current, photos: [...resolved, ...current.photos.filter((photo) => !insertedIds.has(photo.id))] }));
          didSave = true;
        }
        if (outcome.failures.length > 0) {
          setError(`${outcome.failures.length} media item${outcome.failures.length === 1 ? "" : "s"} failed to upload. ${outcome.failures.slice(0, 2).join(" ")}`);
          didSave = false;
        } else if (outcome.warnings.length > 0) {
          setNotice(`${outcome.uploadedCount} media item${outcome.uploadedCount === 1 ? "" : "s"} uploaded. ${outcome.warnings.length} thumbnail${outcome.warnings.length === 1 ? "" : "s"} could not be created, but the originals are saved.`);
        }
      }
      return { savedClientIds, failedClientIds };
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not upload photos.");
      return { savedClientIds, failedClientIds: inputs.filter((input) => !savedClientIds.includes(input.clientId)).map((input) => input.clientId) };
    } finally {
      setSaving(false);
      if (didSave) onSaved();
    }
  }, [backend, currentMember?.display_name, data.photos, data.trip, onSaved, setData, setError, setNotice, user]);

  const saveRoute = useCallback(async (input: { name: string; dayId: string | null; mode: RouteMode }) => {
    if (routeDraftPoints.length < 2 || !data.trip) return;
    const blocked = backendPreviewWriteBlock(Boolean(backend));
    if (blocked) {
      setError(blocked);
      return;
    }
    if (backend && !isAdmin) {
      setError("Only trip admins can save routes.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    let didSave = false;
    try {
      const row = {
        trip_id: data.trip.id,
        day_id: input.dayId,
        name: input.name || "Manual route",
        source: "manual",
        mode: input.mode,
        geometry_geojson: routeGeometry(routeDraftPoints),
        distance_meters: routeDistanceMeters(routeDraftPoints),
        elevation_gain_meters: null,
      };

      if (backend) {
        if (!user) {
          setError("Sign in before saving routes.");
          return;
        }
        const { error: insertError } = await backend.from("route_segments").insert(row);
        if (insertError) setError(insertError.message);
        else {
          await loadData();
          didSave = true;
        }
      } else {
        setData((current) => addRoute(current, { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }));
        didSave = true;
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save route.");
    } finally {
      setSaving(false);
      if (didSave) onSaved();
    }
  }, [backend, data.trip, isAdmin, loadData, onSaved, routeDraftPoints, setData, setError, setNotice, user]);

  return { saving, saveNote, savePhotos, saveRoute };
}
