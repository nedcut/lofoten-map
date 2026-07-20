"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BackendClient, BackendUser } from "@/lib/backend";
import { resolveMemberAvatars, resolvePhotoUrls } from "@/lib/object-store";
import { isMissingSchemaObjectError } from "@/lib/schema-errors";
import type { AdminRequest, Photo, RouteSegment, TripData, TripMember } from "@/types/trip";

const POLL_INTERVAL_MS = 30_000;

type Options = {
  backend: BackendClient | null;
  user: BackendUser | null;
  authLoading: boolean;
  tripSlug: string;
  initialData: TripData;
};

export function useTripData({ backend, user, authLoading, tripSlug, initialData }: Options) {
  const [data, setData] = useState<TripData>(initialData);
  const [loading, setLoading] = useState(Boolean(backend));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminRequestsAvailable, setAdminRequestsAvailable] = useState(true);
  const [profilesAvailable, setProfilesAvailable] = useState(true);
  const loadInFlightRef = useRef<Promise<void> | null>(null);

  const loadData = useCallback((options?: { silent?: boolean }): Promise<void> => {
    if (!backend) return Promise.resolve();
    if (loadInFlightRef.current) return loadInFlightRef.current;

    const request = (async () => {
      if (!options?.silent) setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const { data: trip, error: tripError } = await backend.from("trips").select("*").eq("slug", tripSlug).maybeSingle();
        if (tripError || !trip) {
          setError(tripError
            ? `We could not load the trip right now. Try refreshing, or ask an admin to check access. ${tripError.message}`
            : "The trip is not set up yet. Ask an admin to finish creating it, then refresh.");
          return;
        }
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
        const adminRequestsMissing = isMissingSchemaObjectError(adminRequests.error, "admin_requests");
        setAdminRequestsAvailable(!adminRequestsMissing);
        const profilesMissing = isMissingSchemaObjectError(members.error, "avatar_path");
        setProfilesAvailable(!profilesMissing);
        const membersResult = profilesMissing
          ? await backend.from("trip_members").select("trip_id,user_id,role,display_name,created_at").eq("trip_id", trip.id).order("created_at")
          : members;
        if (adminRequestsMissing || profilesMissing) {
          const stale = [adminRequestsMissing ? "Admin access requests" : null, profilesMissing ? "Member profiles" : null].filter(Boolean).join(" and ");
          setNotice(`${stale} are temporarily unavailable. Apply the latest database migrations, then refresh.`);
        }
        const failure = [days.error, routes.error, photos.error, notes.error, places.error, membersResult.error, adminRequestsMissing ? null : adminRequests.error].find(Boolean);
        if (failure) {
          setError(`The trip loaded, but one section could not sync. Try refreshing. ${failure.message}`);
        } else {
          const resolvedPhotos = resolvePhotoUrls((photos.data ?? []) as Photo[]);
          const memberRows = ((membersResult.data ?? []) as Partial<TripMember>[]).map((member) => ({ avatar_path: null, ...member })) as TripMember[];
          const resolvedMembers = resolveMemberAvatars(memberRows);
          setData({
            trip,
            days: days.data ?? [],
            routeSegments: (routes.data ?? []) as RouteSegment[],
            photos: resolvedPhotos,
            notes: notes.data ?? [],
            places: places.data ?? [],
            members: resolvedMembers,
            adminRequests: adminRequestsMissing ? [] : (adminRequests.data ?? []) as AdminRequest[],
          });
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? `We could not sync the trip right now. Try refreshing. ${loadError.message}` : "We could not sync the trip right now. Try refreshing.");
      } finally {
        if (!options?.silent) setLoading(false);
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
    let stopped = false;
    let timer: number | null = null;
    let polling = false;

    const schedule = () => {
      if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    };
    const poll = async () => {
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
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || polling) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      void poll();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    schedule();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [authLoading, backend, loadData]);

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
