"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Day, LngLat, Note, RouteMode, RouteSegment, TripData } from "@/types/trip";
import { PHOTO_BUCKET } from "@/lib/supabase";
// @/lib/gpx is loaded lazily inside importGpx (below) so its @turf/simplify
// dependency stays out of the initial bundle — GPX import is a rare admin action.
import { lineDistanceMeters } from "@/lib/geo";
import {
  addDay,
  appendGpxImport,
  deleteItem,
  movePhoto as movePhotoInStore,
  patchDay,
  patchNote,
  patchPhoto,
  patchPlace,
  patchRoute,
  patchTrip,
  type DeletableTable,
} from "@/lib/local-trip-store";
import { useStatusMessage } from "./useStatusMessage";

interface Options {
  supabase: SupabaseClient | null;
  user: User | null;
  isAdmin: boolean;
  data: TripData;
  setData: Dispatch<SetStateAction<TripData>>;
  loadData: () => Promise<void>;
  selectedDayId: string | null;
  selectDay: (dayId: string | null) => void;
  /** Mirror failures to the always-visible global status pill. */
  setGlobalError: (message: string | null) => void;
}

/**
 * Every write to the trip's data model: trip/day/route/note/place/photo edits,
 * GPX import, deletes, and optimistic photo moves. Each runs through a shared
 * status channel (surfaced in the admin panel) and clears the global error pill
 * on start. In Supabase mode the write hits Postgres and reloads; in demo mode
 * it applies a pure transform from local-trip-store to the in-memory state.
 *
 * Errors mirror to the global pill too, so a non-admin editing their own map
 * item still sees failures even without the admin panel.
 */
export function useTripMutations({ supabase, user, isAdmin, data, setData, loadData, selectedDayId, selectDay, setGlobalError }: Options) {
  const status = useStatusMessage();
  const { setSaving, setInfo, setError: setStatusError, reset } = status;
  const trip = data.trip;

  const reportError = useCallback(
    (message: string) => {
      setStatusError(message);
      setGlobalError(message);
    },
    [setStatusError, setGlobalError],
  );

  const runAdminOperation = useCallback(
    async (operation: () => Promise<void>) => {
      setSaving(true);
      reset();
      setGlobalError(null);
      try {
        await operation();
      } catch (adminError) {
        reportError(adminError instanceof Error ? adminError.message : "Admin action failed.");
      } finally {
        setSaving(false);
      }
    },
    [setSaving, reset, setGlobalError, reportError],
  );

  const updateTrip = useCallback(
    async (input: { title: string; description: string | null; start_date: string | null; end_date: string | null }) => {
      if (!trip) return;
      await runAdminOperation(async () => {
        if (supabase) {
          const { error } = await supabase.from("trips").update(input).eq("id", trip.id);
          if (error) reportError(error.message);
          else {
            setInfo("Trip updated.");
            await loadData();
          }
        } else {
          setData((current) => patchTrip(current, input));
          setInfo("Trip updated.");
        }
      });
    },
    [trip, runAdminOperation, supabase, reportError, setInfo, loadData, setData],
  );

  const updateDay = useCallback(
    async (dayId: string, input: { day_number: number; date: string | null; title: string | null; summary: string | null }) => {
      if (!trip) return;
      await runAdminOperation(async () => {
        if (supabase) {
          const { error } = await supabase.from("days").update(input).eq("id", dayId).eq("trip_id", trip.id);
          if (error) reportError(error.message);
          else {
            setInfo("Day updated.");
            await loadData();
          }
        } else {
          setData((current) => patchDay(current, dayId, input));
          setInfo("Day updated.");
        }
      });
    },
    [trip, runAdminOperation, supabase, reportError, setInfo, loadData, setData],
  );

  const createDay = useCallback(
    async (input: { day_number: number; date: string | null; title: string | null; summary: string | null }) => {
      if (!trip) return;
      await runAdminOperation(async () => {
        const row = { ...input, trip_id: trip.id };
        if (supabase) {
          const { error } = await supabase.from("days").insert(row);
          if (error) reportError(error.message);
          else {
            setInfo("Day added.");
            await loadData();
          }
        } else {
          setData((current) => addDay(current, { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }));
          setInfo("Day added.");
        }
      });
    },
    [trip, runAdminOperation, supabase, reportError, setInfo, loadData, setData],
  );

  const importGpx = useCallback(
    async (file: File) => {
      if (!trip) return;
      const tripId = trip.id;
      if (supabase && !isAdmin) {
        reportError("Only trip admins can import GPX files.");
        return;
      }
      if (supabase && !user) {
        reportError("Sign in before importing GPX files to Supabase.");
        return;
      }

      const { firstBucketDate, groupPointsByDay, parseGpx, simplifyToLineString } = await import("@/lib/gpx");

      await runAdminOperation(async () => {
        const parsed = parseGpx(await file.text());
        const pointBuckets = groupPointsByDay(parsed.trackPoints).filter((bucket) => bucket.length >= 2);
        if (pointBuckets.length === 0 && parsed.waypoints.length === 0) {
          throw new Error("No usable tracks or waypoints were found in that GPX file.");
        }

        let availableDays = [...data.days].sort((a, b) => a.day_number - b.day_number);
        let nextDayNumber = Math.max(0, ...availableDays.map((day) => day.day_number)) + 1;
        const createdLocalDays: Day[] = [];

        const ensureDay = async (date: string | null) => {
          if (!date) return null;
          const existing = availableDays.find((day) => day.date === date);
          if (existing) return existing;

          const row = { trip_id: tripId, day_number: nextDayNumber++, date, title: `GPX import ${date}`, summary: null };

          if (supabase) {
            const { data: insertedDay, error } = await supabase.from("days").insert(row).select("*").single();
            if (error) throw new Error(error.message);
            availableDays = [...availableDays, insertedDay as Day].sort((a, b) => a.day_number - b.day_number);
            return insertedDay as Day;
          }

          const day: Day = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() };
          createdLocalDays.push(day);
          availableDays = [...availableDays, day].sort((a, b) => a.day_number - b.day_number);
          return day;
        };

        const routeRows: Array<Omit<RouteSegment, "id" | "created_at">> = [];
        for (const bucket of pointBuckets) {
          const date = firstBucketDate(bucket);
          const day = await ensureDay(date);
          const geometry = simplifyToLineString(bucket);
          routeRows.push({
            trip_id: tripId,
            day_id: day?.id ?? null,
            name: parsed.name ? `${parsed.name}${date ? ` (${date})` : ""}` : `GPX route${date ? ` ${date}` : ""}`,
            source: "gpx",
            mode: "hike" as const,
            geometry_geojson: geometry,
            distance_meters: lineDistanceMeters(geometry),
            elevation_gain_meters: null,
          });
        }

        const waypointDayId = pointBuckets.length === 1 ? (await ensureDay(firstBucketDate(pointBuckets[0])))?.id ?? null : null;
        const noteRows: Array<Omit<Note, "id" | "created_at">> = parsed.waypoints.map((waypoint) => ({
          trip_id: tripId,
          day_id: waypointDayId,
          user_id: user?.id ?? null,
          author_name: "GPX import",
          lat: waypoint.lat,
          lng: waypoint.lng,
          body: waypoint.desc ? `${waypoint.name}: ${waypoint.desc}` : waypoint.name,
          note_type: "waypoint",
        }));

        const summary = `Imported ${routeRows.length} route${routeRows.length === 1 ? "" : "s"} and ${noteRows.length} waypoint${noteRows.length === 1 ? "" : "s"}.`;

        if (supabase) {
          if (routeRows.length > 0) {
            const { error } = await supabase.from("route_segments").insert(routeRows);
            if (error) throw new Error(error.message);
          }
          if (noteRows.length > 0) {
            const { error } = await supabase.from("notes").insert(noteRows);
            if (error) throw new Error(error.message);
          }
          setInfo(summary);
          await loadData();
          return;
        }

        const now = new Date().toISOString();
        setData((current) =>
          appendGpxImport(current, {
            days: createdLocalDays,
            routes: routeRows.map((row) => ({ ...row, id: crypto.randomUUID(), created_at: now })),
            notes: noteRows.map((row) => ({ ...row, id: crypto.randomUUID(), created_at: now })),
          }),
        );
        setInfo(summary);
      });
    },
    [trip, supabase, isAdmin, user, runAdminOperation, reportError, data.days, setInfo, loadData, setData],
  );

  const updateRoute = useCallback(
    async (routeId: string, input: { day_id: string | null; name: string | null; mode: RouteMode; source: string | null }) => {
      if (!trip) return;
      await runAdminOperation(async () => {
        if (supabase) {
          const { error } = await supabase.from("route_segments").update(input).eq("id", routeId).eq("trip_id", trip.id);
          if (error) reportError(error.message);
          else {
            setInfo("Route updated.");
            await loadData();
          }
        } else {
          setData((current) => patchRoute(current, routeId, input));
          setInfo("Route updated.");
        }
      });
    },
    [trip, runAdminOperation, supabase, reportError, setInfo, loadData, setData],
  );

  const updateNote = useCallback(
    async (noteId: string, input: { day_id: string | null; author_name: string | null; body: string }) => {
      if (!trip) return;
      await runAdminOperation(async () => {
        if (supabase) {
          const { error } = await supabase.from("notes").update(input).eq("id", noteId).eq("trip_id", trip.id);
          if (error) reportError(error.message);
          else {
            setInfo("Note updated.");
            await loadData();
          }
        } else {
          setData((current) => patchNote(current, noteId, input));
          setInfo("Note updated.");
        }
      });
    },
    [trip, runAdminOperation, supabase, reportError, setInfo, loadData, setData],
  );

  const updatePlace = useCallback(
    async (placeId: string, input: { day_id: string | null; name: string; place_type: string | null; description: string | null; lat: number; lng: number }) => {
      if (!trip) return;
      await runAdminOperation(async () => {
        if (supabase) {
          const { error } = await supabase.from("places").update(input).eq("id", placeId).eq("trip_id", trip.id);
          if (error) reportError(error.message);
          else {
            setInfo("Place updated.");
            await loadData();
          }
        } else {
          setData((current) => patchPlace(current, placeId, input));
          setInfo("Place updated.");
        }
      });
    },
    [trip, runAdminOperation, supabase, reportError, setInfo, loadData, setData],
  );

  const updatePhoto = useCallback(
    async (photoId: string, input: { day_id: string | null; uploader_name: string | null; caption: string | null; lat: number | null; lng: number | null; taken_at: string | null }) => {
      if (!trip) return;
      await runAdminOperation(async () => {
        if (supabase) {
          // .select() makes the update report which rows it touched: RLS filters
          // silently (no error, zero rows), which would otherwise show "Photo
          // updated." while writing nothing — and leave an optimistic marker
          // move on screen that reverts on the next load.
          const { data: updatedRows, error } = await supabase.from("photos").update(input).eq("id", photoId).eq("trip_id", trip.id).select("id");
          if (error) reportError(error.message);
          else if (!updatedRows || updatedRows.length === 0) {
            reportError("The change was not saved — you may not have permission to edit this photo.");
            await loadData();
          } else {
            setInfo("Photo updated.");
            await loadData();
          }
        } else {
          setData((current) => patchPhoto(current, photoId, input));
          setInfo("Photo updated.");
        }
      });
    },
    [trip, runAdminOperation, supabase, reportError, setInfo, loadData, setData],
  );

  // A photo marker was dragged to a new spot. Update local state immediately so
  // the marker stays where it was dropped while the save round-trips; on error
  // updatePhoto surfaces the failure and the next load restores server truth.
  const movePhoto = useCallback(
    async (photoId: string, coordinate: LngLat) => {
      const photo = data.photos.find((item) => item.id === photoId);
      if (!photo) return;
      setData((current) => movePhotoInStore(current, photoId, coordinate));
      await updatePhoto(photoId, {
        day_id: photo.day_id,
        uploader_name: photo.uploader_name,
        caption: photo.caption,
        lat: coordinate.lat,
        lng: coordinate.lng,
        taken_at: photo.taken_at,
      });
    },
    [data.photos, setData, updatePhoto],
  );

  const deleteDataItem = useCallback(
    async (table: DeletableTable, id: string) => {
      if (!trip) return;
      await runAdminOperation(async () => {
        if (supabase) {
          const photoToDelete = table === "photos" ? data.photos.find((photo) => photo.id === id) : null;
          const photoStoragePaths = photoToDelete
            ? [photoToDelete.image_path, photoToDelete.thumbnail_path].filter((path): path is string => Boolean(path))
            : [];
          const { error } = await supabase.from(table).delete().eq("id", id).eq("trip_id", trip.id);
          if (error) reportError(error.message);
          else {
            if (table === "days") selectDay(selectedDayId === id ? null : selectedDayId);
            if (photoStoragePaths.length > 0) {
              const { error: storageError } = await supabase.storage.from(PHOTO_BUCKET).remove(photoStoragePaths);
              if (storageError) reportError(`Item deleted, but photo file cleanup failed: ${storageError.message}`);
              else setInfo("Item deleted.");
            } else {
              setInfo("Item deleted.");
            }
            await loadData();
          }
        } else {
          // Revoke blob URLs from the current snapshot before the state swap, so
          // the side effect stays out of the (re-runnable) state updater.
          deleteItem(data, table, id).revokedUrls.forEach((url) => URL.revokeObjectURL(url));
          if (table === "days") selectDay(selectedDayId === id ? null : selectedDayId);
          setData((current) => deleteItem(current, table, id).data);
          setInfo("Item deleted.");
        }
      });
    },
    [trip, runAdminOperation, supabase, data, reportError, selectDay, selectedDayId, setInfo, loadData, setData],
  );

  return {
    status,
    updateTrip,
    updateDay,
    createDay,
    updateRoute,
    updateNote,
    updatePlace,
    updatePhoto,
    movePhoto,
    deleteDataItem,
    importGpx,
  };
}
