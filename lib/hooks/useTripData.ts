"use client";

import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyRealtimeChange } from "@/lib/realtime-patch";
import { isMissingSchemaObjectError } from "@/lib/schema-errors";
import { resolveMemberAvatars, resolvePhotoUrls } from "@/lib/supabase";
import type { AdminRequest, Photo, RouteSegment, TripData, TripMember } from "@/types/trip";

type Options = {
  supabase: SupabaseClient | null;
  user: User | null;
  authLoading: boolean;
  tripSlug: string;
  initialData: TripData;
};

export function useTripData({ supabase, user, authLoading, tripSlug, initialData }: Options) {
  const [data, setData] = useState<TripData>(initialData);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminRequestsAvailable, setAdminRequestsAvailable] = useState(true);
  const [profilesAvailable, setProfilesAvailable] = useState(true);
  const reloadTimerRef = useRef<number | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const { data: trip, error: tripError } = await supabase.from("trips").select("*").eq("slug", tripSlug).maybeSingle();
      if (tripError || !trip) {
        setError(tripError
          ? `We could not load the trip right now. Try refreshing, or ask an admin to check access. ${tripError.message}`
          : "The trip is not set up yet. Ask an admin to finish creating it, then refresh.");
        return;
      }
      if (user) await supabase.rpc("ensure_trip_membership", { target_trip_slug: tripSlug });
      const adminRequestsQuery = user
        ? supabase.from("admin_requests").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const [days, routes, photos, notes, places, members, adminRequests] = await Promise.all([
        supabase.from("days").select("*").eq("trip_id", trip.id).order("day_number"),
        supabase.from("route_segments").select("*").eq("trip_id", trip.id).order("created_at"),
        supabase.from("photos").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
        supabase.from("notes").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
        supabase.from("places").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
        supabase.from("trip_members").select("trip_id,user_id,role,display_name,avatar_path,created_at").eq("trip_id", trip.id).order("created_at"),
        adminRequestsQuery,
      ]);
      const adminRequestsMissing = isMissingSchemaObjectError(adminRequests.error, "admin_requests");
      setAdminRequestsAvailable(!adminRequestsMissing);
      const profilesMissing = isMissingSchemaObjectError(members.error, "avatar_path");
      setProfilesAvailable(!profilesMissing);
      const membersResult = profilesMissing
        ? await supabase.from("trip_members").select("trip_id,user_id,role,display_name,created_at").eq("trip_id", trip.id).order("created_at")
        : members;
      if (adminRequestsMissing || profilesMissing) {
        const stale = [adminRequestsMissing ? "Admin access requests" : null, profilesMissing ? "Member profiles" : null].filter(Boolean).join(" and ");
        setNotice(`${stale} are temporarily unavailable. Push the latest Supabase migrations, then refresh.`);
      }
      const failure = [days.error, routes.error, photos.error, notes.error, places.error, membersResult.error, adminRequestsMissing ? null : adminRequests.error].find(Boolean);
      if (failure) {
        setError(`The trip loaded, but one section could not sync. Try refreshing. ${failure.message}`);
      } else {
        const resolvedPhotos = resolvePhotoUrls(supabase, (photos.data ?? []) as Photo[]);
        const memberRows = ((membersResult.data ?? []) as Partial<TripMember>[]).map((member) => ({ avatar_path: null, ...member })) as TripMember[];
        const resolvedMembers = resolveMemberAvatars(supabase, memberRows);
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
      setLoading(false);
    }
  }, [supabase, tripSlug, user]);

  const scheduleReload = useCallback(() => {
    if (!supabase) return;
    if (reloadTimerRef.current !== null) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void loadData();
    }, 400);
  }, [loadData, supabase]);

  useEffect(() => {
    if (!supabase) return;
    if (authLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical data-fetch effect: loads trip data when auth/session changes (external system).
    loadData();
  }, [authLoading, loadData, supabase, user]);

  useEffect(() => {
    if (!supabase || !data.trip) return;
    const tripId = data.trip.id;
    const handleChange = (table: string) => (payload: { eventType: "INSERT" | "UPDATE" | "DELETE"; new: Record<string, unknown>; old: Record<string, unknown> }) => {
      setData((current) => applyRealtimeChange(current, table, payload, supabase));
      // Structural tables still benefit from a debounced full reload.
      if (table === "days" || table === "trips") scheduleReload();
    };

    const channel = supabase
      .channel("lofoten-logbook-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "photos", filter: `trip_id=eq.${tripId}` }, handleChange("photos"))
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `trip_id=eq.${tripId}` }, handleChange("notes"))
      .on("postgres_changes", { event: "*", schema: "public", table: "route_segments", filter: `trip_id=eq.${tripId}` }, handleChange("route_segments"))
      .on("postgres_changes", { event: "*", schema: "public", table: "places", filter: `trip_id=eq.${tripId}` }, handleChange("places"))
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_members", filter: `trip_id=eq.${tripId}` }, handleChange("trip_members"));
    if (adminRequestsAvailable) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "admin_requests", filter: `trip_id=eq.${tripId}` }, handleChange("admin_requests"));
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, [adminRequestsAvailable, data.trip, scheduleReload, supabase]);

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
