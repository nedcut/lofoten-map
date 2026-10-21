"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BackendClient, BackendUser } from "@/lib/backend";
import { resolveMemberAvatars, resolvePhotoUrls } from "@/lib/object-store";
import { reuseIfEqual } from "@/lib/trip-data-equal";
import { isMissingSchemaObjectError } from "@/lib/schema-errors";
import type { AdminRequest, Photo, RouteSegment, TripData, TripMember } from "@/types/trip";

// Members can edit, so their tabs check for changes often. Guests only watch;
// a slower check plus a refresh when they come back to the tab keeps their
// view current without downloading the trip every 30 seconds.
const MEMBER_POLL_INTERVAL_MS = 30_000;
const GUEST_POLL_INTERVAL_MS = 180_000;
// Returning to the tab (focus or visibility) refreshes at most this often.
const RETURN_REFRESH_MIN_GAP_MS = 15_000;

/**
 * trips.data_version goes up on every write to the trip or its rows
 * (neon/patches/2026-10-21-trip-data-version.sql). Returns null when the
 * column is not deployed yet, which turns change checks off.
 */
function dataVersionOf(trip: Record<string, unknown>): number | null {
  return typeof trip.data_version === "number" ? trip.data_version : null;
}

type Options = {
  backend: BackendClient | null;
  // True when a client is configured but may still be loading; the trip is
  // "loading" from the first render instead of flashing an empty state.
  backendConfigured?: boolean;
  user: BackendUser | null;
  authLoading: boolean;
  tripSlug: string;
  initialData: TripData;
};

export function useTripData({ backend, backendConfigured = Boolean(backend), user, authLoading, tripSlug, initialData }: Options) {
  const [data, setData] = useState<TripData>(initialData);
  const [loading, setLoading] = useState(Boolean(backend) || backendConfigured);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminRequestsAvailable, setAdminRequestsAvailable] = useState(true);
  const [profilesAvailable, setProfilesAvailable] = useState(true);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  // Bumped by every fetch that starts. Only the newest fetch may write state,
  // so a poll that read the DB before a save cannot overwrite the reload after it.
  const loadGenerationRef = useRef(0);
  // True while the current error/notice was set by a silent poll. A later
  // successful silent poll clears only those, never a message a mutation set.
  const pollMessageRef = useRef(false);
  // data_version of the data on screen, or null when unknown (column missing or
  // the last load failed). A silent poll skips the full reload while it matches.
  const loadedVersionRef = useRef<number | null>(null);
  // When the last load or change check finished, for throttling tab-return refreshes.
  const lastSyncedAtRef = useRef(0);

  const loadData = useCallback((options?: { silent?: boolean }): Promise<void> => {
    if (!backend) return Promise.resolve();
    // Polls share whatever fetch is running. Other reloads (after a save, on
    // sign-in) always start fresh, because an in-flight fetch may predate the write.
    if (options?.silent && loadInFlightRef.current) return loadInFlightRef.current;
    const generation = ++loadGenerationRef.current;
    const isCurrent = () => loadGenerationRef.current === generation;

    const request = (async () => {
      // A silent background poll must not wipe a message the user is still
      // reading, such as a failed save reported by a mutation moments ago.
      if (!options?.silent) {
        setLoading(true);
        setError(null);
        setNotice(null);
        pollMessageRef.current = false;
      }
      let pollMessage = false;
      // Cleared only by a load that fully succeeds.
      let loadedVersion: number | null = null;
      try {
        if (options?.silent && loadedVersionRef.current !== null) {
          const { data: current, error: versionError } = await backend.from("trips").select("data_version").eq("slug", tripSlug).maybeSingle();
          if (!isCurrent()) return;
          if (!versionError && current && dataVersionOf(current) === loadedVersionRef.current) {
            // Nothing changed: keep the data and any messages from the last load.
            loadedVersion = loadedVersionRef.current;
            pollMessage = pollMessageRef.current;
            return;
          }
          // Changed, or the check failed: fall through to a full reload, which
          // reports any real failure the usual way.
        }
        const { data: tripRow, error: tripError } = await backend.from("trips").select("*").eq("slug", tripSlug).maybeSingle();
        if (!isCurrent()) return;
        if (tripError || !tripRow) {
          pollMessage = true;
          setError(tripError
            ? `We could not load the trip right now. Try refreshing, or ask an admin to check access. ${tripError.message}`
            : "The trip is not set up yet. Ask an admin to finish creating it, then refresh.");
          return;
        }
        // Kept out of `trip` so a version bump alone does not replace the trip object.
        const trip = { ...tripRow };
        delete trip.data_version;
        const tripVersion = dataVersionOf(tripRow);
        const adminRequestsQuery = user
          ? backend.from("admin_requests").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null });
        const [days, routes, photos, notes, places, members, adminRequests] = await Promise.all([
          backend.from("days").select("*").eq("trip_id", trip.id).order("day_number"),
          backend.from("route_segments").select("*").eq("trip_id", trip.id).order("created_at"),
          backend.from("photos").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
          backend.from("notes").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
          backend.from("places").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
          backend.from("trip_members").select("trip_id,user_id,role,display_name,avatar_path,created_at").eq("trip_id", trip.id).order("created_at"),
          adminRequestsQuery,
        ]);
        if (!isCurrent()) return;
        const adminRequestsMissing = isMissingSchemaObjectError(adminRequests.error, "admin_requests");
        const profilesMissing = isMissingSchemaObjectError(members.error, "avatar_path");
        const membersResult = profilesMissing
          ? await backend.from("trip_members").select("trip_id,user_id,role,display_name,created_at").eq("trip_id", trip.id).order("created_at")
          : members;
        if (!isCurrent()) return;
        setAdminRequestsAvailable(!adminRequestsMissing);
        setProfilesAvailable(!profilesMissing);
        if (adminRequestsMissing || profilesMissing) {
          const stale = [adminRequestsMissing ? "Admin access requests" : null, profilesMissing ? "Member profiles" : null].filter(Boolean).join(" and ");
          pollMessage = true;
          setNotice(`${stale} are temporarily unavailable. Apply the latest database migrations, then refresh.`);
        }
        const failure = [days.error, routes.error, photos.error, notes.error, places.error, membersResult.error, adminRequestsMissing ? null : adminRequests.error].find(Boolean);
        if (failure) {
          pollMessage = true;
          setError(`The trip loaded, but one section could not sync. Try refreshing. ${failure.message}`);
        } else {
          const resolvedPhotos = resolvePhotoUrls((photos.data ?? []) as Photo[]);
          const memberRows = ((membersResult.data ?? []) as Partial<TripMember>[]).map((member) => ({ avatar_path: null, ...member })) as TripMember[];
          const resolvedMembers = resolveMemberAvatars(memberRows);
          const next: TripData = {
            trip,
            days: days.data ?? [],
            routeSegments: (routes.data ?? []) as RouteSegment[],
            photos: resolvedPhotos,
            notes: notes.data ?? [],
            places: places.data ?? [],
            members: resolvedMembers,
            adminRequests: adminRequestsMissing ? [] : (adminRequests.data ?? []) as AdminRequest[],
          };
          // Keep the previous object when nothing changed. Every marker effect
          // and memo downstream keys on identity, so an unconditional replace
          // would tear down and rebuild the map layers on every 30s poll.
          setData((current) => reuseIfEqual(current, next));
          // The trips row was read before the child rows, so this version can only
          // be older than what was loaded. At worst the next poll reloads once more.
          loadedVersion = tripVersion;
          if (options?.silent && pollMessageRef.current && !pollMessage) {
            setError(null);
            setNotice(null);
          }
        }
      } catch (loadError) {
        if (!isCurrent()) return;
        pollMessage = true;
        setError(loadError instanceof Error ? `We could not sync the trip right now. Try refreshing. ${loadError.message}` : "We could not sync the trip right now. Try refreshing.");
      } finally {
        if (isCurrent()) {
          loadedVersionRef.current = loadedVersion;
          lastSyncedAtRef.current = Date.now();
          if (options?.silent) pollMessageRef.current = pollMessage;
          if (!options?.silent) setLoading(false);
        }
      }
    })();
    loadInFlightRef.current = request;
    const clearInFlight = () => {
      if (loadInFlightRef.current === request) loadInFlightRef.current = null;
    };
    void request.then(clearInFlight, clearInFlight);
    return request;
  }, [backend, tripSlug, user]);

  useEffect(() => {
    if (!backend) return;
    if (authLoading) return;
    void loadData();
  }, [authLoading, backend, loadData, user]);

  useEffect(() => {
    if (!backend || authLoading) return;
    const interval = user ? MEMBER_POLL_INTERVAL_MS : GUEST_POLL_INTERVAL_MS;
    let stopped = false;
    let timer: number | null = null;
    let polling = false;

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(poll, interval);
    };
    const poll = async () => {
      timer = null;
      if (stopped || polling) return;
      if (document.visibilityState !== "visible") return;
      polling = true;
      try {
        await loadData({ silent: true });
      } finally {
        polling = false;
        schedule();
      }
    };
    const handleReturn = () => {
      if (document.visibilityState !== "visible" || polling) return;
      if (Date.now() - lastSyncedAtRef.current < RETURN_REFRESH_MIN_GAP_MS) {
        // Just synced: make sure a poll is scheduled, but do not fetch again now.
        if (timer === null) schedule();
        return;
      }
      void poll();
    };

    document.addEventListener("visibilitychange", handleReturn);
    window.addEventListener("focus", handleReturn);
    schedule();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", handleReturn);
      window.removeEventListener("focus", handleReturn);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [authLoading, backend, loadData, user]);

  return {
    data,
    setData,
    loading,
    error,
    notice,
    setError,
    setNotice,
    loadData,
    adminRequestsAvailable,
    profilesAvailable,
  };
}
