"use client";

import dynamic from "next/dynamic";
import mapboxgl from "mapbox-gl";
import { length } from "@turf/turf";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LineString } from "geojson";
import type { User } from "@supabase/supabase-js";
import { AlertCircle, Loader2, LogIn, Mail, Play, ShieldCheck, Sparkles, UserRound, X } from "lucide-react";
import { AddNotePanel } from "@/components/AddNotePanel";
import { DaySidebar } from "@/components/DaySidebar";
import { JourneyPlayback, type JourneyFilter } from "@/components/JourneyPlayback";
import { ManualRoutePanel } from "@/components/ManualRoutePanel";
import { MapLegend } from "@/components/MapLegend";
import { MobileSheet } from "@/components/MobileSheet";
import { RouteDraftLayer } from "@/components/RouteDraftLayer";
import { TripLayers, type MapItemKind } from "@/components/TripLayers";
import { EditItemPanel, type EditTarget } from "@/components/EditItemPanel";
import { ProfilePanel } from "@/components/ProfilePanel";
import { UploadPhotoPanel, type PhotoUploadItemInput, type PhotoUploadProgress, type PhotoUploadSaveResult } from "@/components/UploadPhotoPanel";
import { deriveTripAccess } from "@/lib/access";
import { gpxTimeToTripDate, groupPointsByDay, parseGpx, simplifyToLineString } from "@/lib/gpx";
import { buildJourneyItems } from "@/lib/journey";
import { prepareAvatarFile } from "@/lib/avatar-processing";
import { partitionDuplicatePhotos } from "@/lib/photo-dedup";
import { preparePhotoFiles } from "@/lib/photo-processing";
import { isMissingSchemaObjectError } from "@/lib/schema-errors";
import { AVATAR_BUCKET, PHOTO_BUCKET, getSupabaseBrowserClient, resolveMemberAvatars, resolvePhotoUrls } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { AdminRequest, Day, LngLat, MapClickMode, Note, Photo, Place, RouteMode, RouteSegment, Trip, TripData, TripMember } from "@/types/trip";

const MapView = dynamic(() => import("@/components/MapView").then((mod) => mod.MapView), { ssr: false });

const demoTripId = "00000000-0000-4000-8000-000000000001";
const demoCreatedAt = "2026-01-01T00:00:00.000Z";
const demoDays: Day[] = [
  { id: "00000000-0000-4000-8000-000000000101", trip_id: demoTripId, day_number: 1, date: "2026-07-12", title: "Reine arrival", summary: "Settle in, ferry views, and first village walk.", created_at: demoCreatedAt },
  { id: "00000000-0000-4000-8000-000000000102", trip_id: demoTripId, day_number: 2, date: "2026-07-13", title: "Kjerkfjorden hike", summary: "Trail day toward fjord viewpoints.", created_at: demoCreatedAt },
  { id: "00000000-0000-4000-8000-000000000103", trip_id: demoTripId, day_number: 3, date: "2026-07-14", title: "Moskenes coast", summary: "Weather window, photo stops, and camp scouting.", created_at: demoCreatedAt },
];
const demoTrip: Trip = { id: demoTripId, title: "Lofoten 2026", slug: "lofoten-2026", description: "A shared Lofoten hiking logbook.", start_date: "2026-07-12", end_date: "2026-07-18", created_at: demoCreatedAt };
const demoRoutes: RouteSegment[] = [{ id: "route-demo", trip_id: demoTripId, day_id: demoDays[1].id, name: "Reine to Kjerkfjorden scouting route", source: "seed", mode: "hike", geometry_geojson: { type: "LineString", coordinates: [[13.089, 67.932], [13.068, 67.941], [13.045, 67.954], [13.019, 67.967]] }, distance_meters: 6200, elevation_gain_meters: 420, created_at: demoCreatedAt }];
const demoNotes: Note[] = [{ id: "note-demo-1", trip_id: demoTripId, day_id: demoDays[0].id, user_id: null, author_name: "Maja", lat: 67.9328, lng: 13.0888, body: "Sunset light on Reinebringen looked unreal from the harbor.", note_type: "note", created_at: demoCreatedAt }];
const demoPlaces: Place[] = [{ id: "place-demo-1", trip_id: demoTripId, day_id: demoDays[2].id, name: "Coffee and cinnamon buns", lat: 67.9007, lng: 13.0461, place_type: "food", description: "Good meetup stop before the ferry.", created_at: demoCreatedAt }];
const demoData: TripData = { trip: demoTrip, days: demoDays, routeSegments: demoRoutes, photos: [], notes: demoNotes, places: demoPlaces, members: [], adminRequests: [] };
const emptyData: TripData = { trip: null, days: [], routeSegments: [], photos: [], notes: [], places: [], members: [], adminRequests: [] };
const UPLOAD_CONCURRENCY = 4;
// Storage files are uuid-named and never rewritten, so browsers and the CDN
// can cache them for a year instead of re-downloading every hour.
const IMMUTABLE_CACHE_SECONDS = "31536000";


async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const next = items[index++];
      await worker(next);
    }
  });
  await Promise.all(runners);
}

function routeGeometry(points: LngLat[]): LineString {
  return { type: "LineString", coordinates: points.map((point) => [point.lng, point.lat]) };
}

function routeDistanceMeters(points: LngLat[]) {
  if (points.length < 2) return 0;
  const geometry = routeGeometry(points);
  return Math.round(length({ type: "Feature", geometry, properties: {} }, { units: "kilometers" }) * 1000);
}

function lineDistanceMeters(geometry: LineString) {
  if (geometry.coordinates.length < 2) return 0;
  return Math.round(length({ type: "Feature", geometry, properties: {} }, { units: "kilometers" }) * 1000);
}

function firstBucketDate(points: { time: string | null }[]) {
  for (const point of points) {
    const date = gpxTimeToTripDate(point.time);
    if (date) return date;
  }
  return null;
}

function fileExtension(file: File) {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return file.name.split(".").pop()?.toLowerCase() || "jpg";
}

export default function Home() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [data, setData] = useState<TripData>(() => (supabase ? emptyData : demoData));
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authMessageTone, setAuthMessageTone] = useState<"info" | "error">("info");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [memberMessage, setMemberMessage] = useState<string | null>(null);
  const [memberMessageTone, setMemberMessageTone] = useState<"info" | "error">("info");
  const [memberSaving, setMemberSaving] = useState(false);
  const [adminDataMessage, setAdminDataMessage] = useState<string | null>(null);
  const [adminDataMessageTone, setAdminDataMessageTone] = useState<"info" | "error">("info");
  const [adminDataSaving, setAdminDataSaving] = useState(false);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [layerVisibility, setLayerVisibility] = useState({ photos: true, notes: true, routes: true });
  const [clickMode, setClickMode] = useState<MapClickMode>("idle");
  const [pendingCoordinate, setPendingCoordinate] = useState<LngLat | null>(null);
  const [routeDraftPoints, setRouteDraftPoints] = useState<LngLat[]>([]);
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [panel, setPanel] = useState<"photo" | "note" | "route" | null>(null);
  const [editTargetRef, setEditTargetRef] = useState<{ kind: MapItemKind; id: string } | null>(null);
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);
  const [journeyParamChecked, setJourneyParamChecked] = useState(false);
  const [journeyFilter, setJourneyFilter] = useState<JourneyFilter>("all");
  const [journeyUploaderFilter, setJourneyUploaderFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminRequestsAvailable, setAdminRequestsAvailable] = useState(true);
  const [profilesAvailable, setProfilesAvailable] = useState(true);

  const tripSlug = process.env.NEXT_PUBLIC_TRIP_SLUG ?? "lofoten-2026";

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!mounted) return;
      setUser(sessionData.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setAuthMessage(null);
      setAuthMessageTone("info");
      // Close the sign-in modal once a session lands. Data reloads via the
      // auth-driven effect below; signing out drops to the public view, not blank.
      if (session?.user) setAuthPanelOpen(false);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

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
      // Signed-in visitors auto-join as members before we read the roster, so the
      // contribute controls light up on first sign-in without an admin invite.
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
      // Tolerate a deployed schema that predates the avatar migration: refetch
      // the roster without avatar_path so membership and roles keep working,
      // and hide profile editing until the migration lands.
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
        setData({ trip, days: days.data ?? [], routeSegments: (routes.data ?? []) as RouteSegment[], photos: resolvedPhotos, notes: notes.data ?? [], places: places.data ?? [], members: resolvedMembers, adminRequests: adminRequestsMissing ? [] : (adminRequests.data ?? []) as AdminRequest[] });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? `We could not sync the trip right now. Try refreshing. ${loadError.message}` : "We could not sync the trip right now. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [supabase, tripSlug, user]);

  useEffect(() => {
    if (!supabase) return;
    if (authLoading) return;
    // Load for everyone — reads are public. Re-runs on sign in/out so member-only
    // controls and any write-gated data refresh with the new session.
    loadData();
  }, [authLoading, loadData, supabase, user]);

  useEffect(() => {
    if (!supabase || !data.trip) return;
    const channel = supabase
      .channel("lofoten-logbook-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "photos", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "route_segments", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "places", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_members", filter: `trip_id=eq.${data.trip.id}` }, loadData);
    if (adminRequestsAvailable) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: "admin_requests", filter: `trip_id=eq.${data.trip.id}` }, loadData);
    }
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [adminRequestsAvailable, data.trip, loadData, supabase]);

  async function signIn(email: string) {
    if (!supabase) return;
    setAuthSubmitting(true);
    setAuthMessage(null);
    setAuthMessageTone("info");
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setAuthMessageTone(signInError ? "error" : "info");
    setAuthMessage(signInError ? signInError.message : "Check your email for a sign-in link.");
    setAuthSubmitting(false);
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    setAuthSubmitting(true);
    setAuthMessage(null);
    setAuthMessageTone("info");
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (signInError) {
      setAuthMessageTone("error");
      setAuthMessage(signInError.message);
      setAuthSubmitting(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    // Keep the data — reads are public, so signing out just drops edit access.
  }

  async function saveProfile(input: { displayName: string; avatarFile: File | null; removeAvatar: boolean }) {
    if (!supabase || !data.trip || !user) return;
    setProfileSaving(true);
    setError(null);
    setNotice(null);
    try {
      // Default to whatever avatar the member already has; only the two write
      // paths below (new upload / explicit removal) change it.
      let avatarPath: string | null = currentMember?.avatar_path ?? null;
      if (input.avatarFile) {
        const prepared = await prepareAvatarFile(input.avatarFile);
        // Path is keyed on the user id so it satisfies the storage RLS policy,
        // and carries a fresh uuid so the public URL busts any CDN cache.
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, prepared, { cacheControl: IMMUTABLE_CACHE_SECONDS, upsert: false, contentType: prepared.type || "image/jpeg" });
        if (uploadError) {
          setError(`Could not upload your photo. ${uploadError.message}`);
          return;
        }
        // Best-effort cleanup of the previous avatar so the bucket stays tidy.
        if (currentMember?.avatar_path) await supabase.storage.from(AVATAR_BUCKET).remove([currentMember.avatar_path]);
        avatarPath = path;
      } else if (input.removeAvatar) {
        if (currentMember?.avatar_path) await supabase.storage.from(AVATAR_BUCKET).remove([currentMember.avatar_path]);
        avatarPath = null;
      }

      const { error: rpcError } = await supabase.rpc("update_my_trip_profile", {
        target_trip_slug: data.trip.slug,
        new_display_name: input.displayName,
        new_avatar_path: avatarPath,
      });
      if (rpcError) {
        setError(`Could not save your profile. ${rpcError.message}`);
        return;
      }
      await loadData();
      setNotice("Profile updated.");
      setProfilePanelOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function grantMember(input: { email: string; role: "admin" | "member" }) {
    if (!supabase || !data.trip) return;
    setMemberSaving(true);
    setMemberMessage(null);
    setMemberMessageTone("info");
    try {
      const { error: grantError } = await supabase.rpc("grant_trip_member_by_email", {
        target_trip_slug: data.trip.slug,
        target_email: input.email,
        target_role: input.role,
      });
      if (grantError) {
        setMemberMessageTone("error");
        setMemberMessage(grantError.message);
      } else {
        setMemberMessageTone("info");
        setMemberMessage(`${input.email} added as ${input.role}.`);
        await loadData();
      }
    } catch (grantError) {
      setMemberMessageTone("error");
      setMemberMessage(grantError instanceof Error ? grantError.message : "Could not update members.");
    } finally {
      setMemberSaving(false);
    }
  }

  // Shared wrapper for the member-management RPCs: clears the panel message, runs
  // the call, surfaces success/failure, and reloads on success.
  async function runMemberOperation(operation: () => PromiseLike<{ error: { message: string } | null }>, successMessage: string) {
    if (!supabase || !data.trip) return;
    setMemberSaving(true);
    setMemberMessage(null);
    setMemberMessageTone("info");
    try {
      const { error: opError } = await operation();
      if (opError) {
        setMemberMessageTone("error");
        setMemberMessage(opError.message);
      } else {
        setMemberMessageTone("info");
        setMemberMessage(successMessage);
        await loadData();
      }
    } catch (opError) {
      setMemberMessageTone("error");
      setMemberMessage(opError instanceof Error ? opError.message : "Could not update members.");
    } finally {
      setMemberSaving(false);
    }
  }

  async function requestAdmin() {
    await runMemberOperation(
      () => supabase!.rpc("request_trip_admin", { target_trip_slug: data.trip!.slug }),
      "Admin request sent. An existing admin will review it.",
    );
  }

  async function setMemberRole(targetUserId: string, role: "admin" | "member") {
    await runMemberOperation(
      () => supabase!.rpc("set_member_role", { target_trip_slug: data.trip!.slug, target_user_id: targetUserId, new_role: role }),
      role === "admin" ? "Member promoted to admin." : "Member set back to member.",
    );
  }

  async function resolveAdminRequest(requestId: string, approve: boolean) {
    await runMemberOperation(
      () => supabase!.rpc("resolve_admin_request", { request_id: requestId, approve }),
      approve ? "Request approved." : "Request denied.",
    );
  }

  const filtered = useMemo(() => {
    const matches = (dayId: string | null) => !selectedDayId || dayId === selectedDayId;
    return {
      routes: data.routeSegments.filter((item) => matches(item.day_id)),
      photos: data.photos.filter((item) => matches(item.day_id)),
      notes: data.notes.filter((item) => matches(item.day_id)),
      places: data.places.filter((item) => matches(item.day_id)),
    };
  }, [data, selectedDayId]);
  const allJourneyItems = useMemo(() => buildJourneyItems(data), [data]);
  const journeyItems = useMemo(() => allJourneyItems.filter((item) => {
    if (journeyFilter === "photos" && item.kind !== "photo") return false;
    if (journeyFilter === "journal" && item.kind === "photo") return false;
    if (journeyUploaderFilter && (item.kind !== "photo" || item.primary.uploader_name !== journeyUploaderFilter)) return false;
    return true;
  }), [allJourneyItems, journeyFilter, journeyUploaderFilter]);
  const activeJourneyIndex = useMemo(() => {
    if (!activeJourneyId) return -1;
    return journeyItems.findIndex((item) => item.id === activeJourneyId);
  }, [activeJourneyId, journeyItems]);
  const journeyOpen = Boolean(activeJourneyId);

  const access = useMemo(
    () => deriveTripAccess({ supabaseEnabled: Boolean(supabase), userId: user?.id ?? null, members: data.members, adminRequests: data.adminRequests }),
    [data.adminRequests, data.members, supabase, user?.id],
  );
  const { currentMember, currentUserId, canContribute, isAdmin } = access;

  // Resolve the popup-selected item live from data, so the editor reflects updates
  // and closes automatically if the item is deleted (here or by another member).
  const editTarget = useMemo<EditTarget | null>(() => {
    if (!editTargetRef) return null;
    const { kind, id } = editTargetRef;
    if (kind === "photo") { const item = data.photos.find((photo) => photo.id === id); return item ? { kind, item } : null; }
    if (kind === "note") { const item = data.notes.find((note) => note.id === id); return item ? { kind, item } : null; }
    if (kind === "place") { const item = data.places.find((place) => place.id === id); return item ? { kind, item } : null; }
    const item = data.routeSegments.find((route) => route.id === id); return item ? { kind, item } : null;
  }, [editTargetRef, data]);
  const memberAdmin = access.showMemberAdminControls
    ? {
      members: data.members,
      requests: adminRequestsAvailable ? access.pendingAdminRequests : [],
      currentUserId,
      message: memberMessage,
      messageTone: memberMessageTone,
      isSaving: memberSaving,
      onGrantMember: grantMember,
      onSetMemberRole: setMemberRole,
      onResolveRequest: resolveAdminRequest,
    }
    : null;
  // Shown to signed-in members who are not admins: a way to ask for an upgrade.
  const adminRequest = adminRequestsAvailable && access.showAdminRequestControls
    ? { status: access.currentUserAdminRequest?.status ?? null, isSaving: memberSaving, message: memberMessage, messageTone: memberMessageTone, onRequestAdmin: requestAdmin }
    : null;
  const routeDraftDistance = useMemo(() => routeDistanceMeters(routeDraftPoints), [routeDraftPoints]);
  const tripTitle = data.trip?.title ?? "Trip Logbook";
  const mapActionsEnabled = !mapUnavailable;
  const adminData = isAdmin
    ? {
      trip: data.trip,
      days: data.days,
      routes: data.routeSegments,
      notes: data.notes,
      places: data.places,
      photos: data.photos,
      message: adminDataMessage,
      messageTone: adminDataMessageTone,
      isSaving: adminDataSaving,
      onUpdateTrip: updateTrip,
      onCreateDay: createDay,
      onUpdateDay: updateDay,
      onUpdateRoute: updateRoute,
      onUpdateNote: updateNote,
      onUpdatePlace: updatePlace,
      onUpdatePhoto: updatePhoto,
      onDeleteItem: deleteDataItem,
      onImportGpx: importGpx,
    }
    : null;

  const replaceJourneyUrl = useCallback((itemId: string | null, mode: "push" | "replace" = "replace") => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (itemId) url.searchParams.set("journey", itemId);
    else url.searchParams.delete("journey");
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const openJourneyAt = useCallback((itemId: string, mode: "push" | "replace" = "push") => {
    setActiveJourneyId(itemId);
    replaceJourneyUrl(itemId, mode);
  }, [replaceJourneyUrl]);

  const closeJourney = useCallback(() => {
    setActiveJourneyId(null);
    replaceJourneyUrl(null);
  }, [replaceJourneyUrl]);

  const selectJourneyIndex = useCallback((index: number) => {
    const item = journeyItems[index];
    if (!item) return;
    openJourneyAt(item.id, "replace");
  }, [journeyItems, openJourneyAt]);

  // Tapping a dot in the journey mini-map jumps straight to that item.
  const selectJourneyItem = useCallback((id: string) => {
    openJourneyAt(id, "replace");
  }, [openJourneyAt]);

  // Opening Journey Mode from a main-map photo popup. Clear any active filters so
  // the chosen photo is guaranteed to be in the sequence, and push history so the
  // browser back button exits playback.
  const openJourneyFromMap = useCallback((photoId: string) => {
    setJourneyFilter("all");
    setJourneyUploaderFilter("");
    openJourneyAt(`photo:${photoId}`, "push");
  }, [openJourneyAt]);

  const nextJourneyItem = useCallback(() => {
    if (journeyItems.length === 0) return;
    const currentIndex = activeJourneyIndex >= 0 ? activeJourneyIndex : 0;
    const nextIndex = (currentIndex + 1) % journeyItems.length;
    selectJourneyIndex(nextIndex);
  }, [activeJourneyIndex, journeyItems.length, selectJourneyIndex]);

  const prevJourneyItem = useCallback(() => {
    if (journeyItems.length === 0) return;
    const currentIndex = activeJourneyIndex >= 0 ? activeJourneyIndex : 0;
    const nextIndex = (currentIndex - 1 + journeyItems.length) % journeyItems.length;
    selectJourneyIndex(nextIndex);
  }, [activeJourneyIndex, journeyItems.length, selectJourneyIndex]);

  useEffect(() => {
    if (journeyParamChecked || loading || allJourneyItems.length === 0) return;
    const token = new URL(window.location.href).searchParams.get("journey");
    if (token && allJourneyItems.some((item) => item.id === token)) setActiveJourneyId(token);
    setJourneyParamChecked(true);
  }, [allJourneyItems, journeyParamChecked, loading]);

  useEffect(() => {
    const handler = () => {
      const token = new URL(window.location.href).searchParams.get("journey");
      setActiveJourneyId(token && allJourneyItems.some((item) => item.id === token) ? token : null);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [allJourneyItems]);

  useEffect(() => {
    if (!activeJourneyId) return;
    if (journeyItems.some((item) => item.id === activeJourneyId)) return;
    // The active item dropped out of the filtered list. If others still match,
    // snap to the first of them. If the list is now empty but the item still
    // exists overall, the user just narrowed a filter past everything — keep the
    // viewer open so its filter controls stay reachable. Only close when the
    // item is genuinely gone (e.g. deleted via realtime) with nothing left.
    if (journeyItems[0]) {
      openJourneyAt(journeyItems[0].id, "replace");
    } else if (!allJourneyItems.some((item) => item.id === activeJourneyId)) {
      closeJourney();
    }
  }, [activeJourneyId, allJourneyItems, closeJourney, journeyItems, openJourneyAt]);

  // While Journey Mode is open the main map is hidden (display:none) behind the
  // full-screen viewer, so only the mini-map renders a live WebGL context. A
  // display:none canvas loses its dimensions, so resize it once we return.
  useEffect(() => {
    if (journeyOpen || !map) return;
    const id = window.setTimeout(() => map.resize(), 60);
    return () => window.clearTimeout(id);
  }, [journeyOpen, map]);

  const handleCoordinatePick = useCallback((coordinate: LngLat) => {
    if (clickMode === "draw-route") {
      setRouteDraftPoints((current) => [...current, coordinate]);
      return;
    }
    setPendingCoordinate(coordinate);
  }, [clickMode]);

  const handleMapReady = useCallback((nextMap: mapboxgl.Map) => {
    setMapUnavailable(false);
    setMap(nextMap);
  }, []);

  const handleMapUnavailable = useCallback(() => {
    setMap(null);
    setMapUnavailable(true);
    setClickMode("idle");
    setPendingCoordinate(null);
    setRouteDraftPoints([]);
    setPanel(null);
  }, []);

  function startPanel(next: "photo" | "note" | "route") {
    if (!mapActionsEnabled) return;
    setPanel(next);
    setPendingCoordinate(null);
    if (next === "route") {
      setRouteDraftPoints([]);
      setClickMode("draw-route");
    } else {
      setRouteDraftPoints([]);
      setClickMode(next === "photo" ? "place-photo" : "add-note");
    }
  }

  function closePanel() {
    setPanel(null);
    setClickMode("idle");
    setPendingCoordinate(null);
    setRouteDraftPoints([]);
  }

  // Opened from a map popup. RLS enforces who may write; the popup only shows the
  // buttons to owners/admins, and these handlers reuse the existing data mutations.
  function startEditFromMap(kind: MapItemKind, id: string) {
    closePanel();
    setEditTargetRef({ kind, id });
  }

  async function deleteFromMap(kind: MapItemKind, id: string) {
    const table = ({ photo: "photos", note: "notes", place: "places", route: "route_segments" } as const)[kind];
    if (!window.confirm("Delete this item? This can't be undone.")) return;
    await deleteDataItem(table, id);
  }

  async function saveNote(input: { body: string; authorName: string; dayId: string | null }) {
    if (!pendingCoordinate || !input.body || !data.trip) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    let didSave = false;
    try {
      const row = { trip_id: data.trip.id, day_id: input.dayId, user_id: user?.id ?? null, author_name: input.authorName || "Friend", lat: pendingCoordinate.lat, lng: pendingCoordinate.lng, body: input.body, note_type: "note" };
      if (supabase) {
        if (!user) {
          setError("Sign in before saving notes to Supabase.");
          return;
        }
        const { error: insertError } = await supabase.from("notes").insert(row);
        if (insertError) setError(insertError.message);
        else {
          await loadData();
          didSave = true;
        }
      } else {
        setData((current) => ({ ...current, notes: [{ ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...current.notes] }));
        didSave = true;
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save note.");
    } finally {
      setSaving(false);
      if (didSave) closePanel();
    }
  }

  async function savePhotos(inputs: PhotoUploadItemInput[], onProgress: (progress: PhotoUploadProgress) => void): Promise<PhotoUploadSaveResult | void> {
    if (inputs.length === 0 || !data.trip) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    // Uploader is the signed-in user — no name field needed in the upload flow.
    const uploaderName = currentMember?.display_name || user?.email || "Friend";
    let didSave = false;
    const savedClientIds: string[] = [];
    const failedClientIds: string[] = [];
    let completedUploads = 0;
    const markUploadComplete = () => {
      completedUploads += 1;
      onProgress({ completed: completedUploads, total: inputs.length });
    };
    try {
      if (!supabase) {
        const rows = await Promise.all(inputs.map(async (input) => {
          const prepared = await preparePhotoFiles(input.file);
          const row = {
            id: crypto.randomUUID(),
            trip_id: data.trip!.id,
            day_id: input.dayId,
            user_id: user?.id ?? null,
            uploader_name: uploaderName,
            content_hash: input.contentHash,
            // Demo mode has no Storage: preview straight from local blob URLs and
            // leave the storage paths empty (never read in this branch).
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
        setData((current) => ({ ...current, photos: [...rows, ...current.photos] }));
        savedClientIds.push(...inputs.map((input) => input.clientId));
        didSave = true;
      } else {
        if (!user) {
          setError("Sign in before uploading photos to Supabase.");
          return;
        }
        const rows: Array<{
          client_id: string;
          trip_id: string;
          day_id: string | null;
          uploader_name: string;
          content_hash: string;
          image_path: string;
          thumbnail_path: string | null;
          lat: number;
          lng: number;
          taken_at: string | null | undefined;
          caption: string;
          exif_found: boolean;
        }> = [];
        const failures: string[] = [];
        const warnings: string[] = [];
        const uploadedPaths: string[] = [];
        const { uploads: uploadCandidates, duplicates } = partitionDuplicatePhotos(
          inputs.map((input) => ({ input, contentHash: input.contentHash, takenAt: input.exif?.takenAt ?? null, coordinate: input.coordinate })),
          data.photos,
        );
        for (const duplicate of duplicates) {
          failures.push(`${duplicate.input.file.name}: duplicate photo skipped`);
          failedClientIds.push(duplicate.input.clientId);
          markUploadComplete();
        }
        const uploadInputs = uploadCandidates.map((candidate) => candidate.input);

        await mapWithConcurrency(uploadInputs, UPLOAD_CONCURRENCY, async (input) => {
          const prepared = await preparePhotoFiles(input.file);
          const extension = fileExtension(prepared.imageFile);
          const path = `${data.trip!.slug}/${crypto.randomUUID()}.${extension}`;
          const thumbnailPath = prepared.thumbnailFile ? `${data.trip!.slug}/thumbs/${crypto.randomUUID()}.jpg` : null;
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
            markUploadComplete();
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
            trip_id: data.trip!.id,
            day_id: input.dayId,
            uploader_name: uploaderName,
            content_hash: input.contentHash,
            image_path: path,
            thumbnail_path: thumbnailStoragePath,
            lat: input.coordinate.lat,
            lng: input.coordinate.lng,
            taken_at: input.exif?.takenAt,
            caption: input.caption,
            exif_found: input.exif?.exifFound ?? false,
          });
          markUploadComplete();
        });

        if (rows.length > 0) {
          // Re-check hashes against the database rather than local state, so a
          // photo someone else uploaded mid-batch is skipped instead of failing
          // the whole insert on the unique index.
          const { data: clashData } = await supabase.from("photos").select("content_hash").eq("trip_id", data.trip.id).in("content_hash", rows.map((row) => row.content_hash));
          const clashes = new Set(((clashData ?? []) as Array<{ content_hash: string }>).map((row) => row.content_hash));
          const clashedRows = rows.filter((row) => clashes.has(row.content_hash));
          const freshRows = rows.filter((row) => !clashes.has(row.content_hash));
          if (clashedRows.length > 0) {
            await supabase.storage.from(PHOTO_BUCKET).remove(clashedRows.flatMap((row) => [row.image_path, row.thumbnail_path].filter((rowPath): rowPath is string => Boolean(rowPath))));
            failures.push(`${clashedRows.length} photo${clashedRows.length === 1 ? "" : "s"} already uploaded by someone else, skipped`);
            failedClientIds.push(...clashedRows.map((row) => row.client_id));
          }
          const insertRows = freshRows.map((row) => ({
            trip_id: row.trip_id,
            day_id: row.day_id,
            uploader_name: row.uploader_name,
            content_hash: row.content_hash,
            image_path: row.image_path,
            thumbnail_path: row.thumbnail_path,
            lat: row.lat,
            lng: row.lng,
            taken_at: row.taken_at,
            caption: row.caption,
            exif_found: row.exif_found,
          }));
          if (insertRows.length > 0) {
            const { error: insertError } = await supabase.from("photos").insert(insertRows);
            if (insertError) {
              if (uploadedPaths.length > 0) await supabase.storage.from(PHOTO_BUCKET).remove(uploadedPaths);
              setError(insertError.message);
              failedClientIds.push(...freshRows.map((row) => row.client_id));
            } else {
              savedClientIds.push(...freshRows.map((row) => row.client_id));
              await loadData();
              didSave = true;
            }
          }
        }
        if (failures.length > 0) {
          setError(`${failures.length} photo${failures.length === 1 ? "" : "s"} failed to upload. ${failures.slice(0, 2).join(" ")}`);
          didSave = false;
        } else if (warnings.length > 0) {
          setNotice(`${rows.length} photo${rows.length === 1 ? "" : "s"} uploaded. ${warnings.length} thumbnail${warnings.length === 1 ? "" : "s"} could not be created, but the original photos are saved.`);
        }
      }
      return { savedClientIds, failedClientIds };
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not upload photos.");
      return { savedClientIds, failedClientIds: inputs.filter((input) => !savedClientIds.includes(input.clientId)).map((input) => input.clientId) };
    } finally {
      setSaving(false);
      if (didSave) closePanel();
    }
  }

  async function saveRoute(input: { name: string; dayId: string | null; mode: RouteMode }) {
    if (routeDraftPoints.length < 2 || !data.trip) return;
    if (supabase && !isAdmin) {
      setError("Only trip admins can save routes.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    let didSave = false;
    try {
      const geometry = routeGeometry(routeDraftPoints);
      const row = {
        trip_id: data.trip.id,
        day_id: input.dayId,
        name: input.name || "Manual route",
        source: "manual",
        mode: input.mode,
        geometry_geojson: geometry,
        distance_meters: routeDistanceMeters(routeDraftPoints),
        elevation_gain_meters: null,
      };

      if (supabase) {
        if (!user) {
          setError("Sign in before saving routes to Supabase.");
          return;
        }
        const { error: insertError } = await supabase.from("route_segments").insert(row);
        if (insertError) setError(insertError.message);
        else {
          await loadData();
          didSave = true;
        }
      } else {
        setData((current) => ({
          ...current,
          routeSegments: [...current.routeSegments, { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }],
        }));
        didSave = true;
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save route.");
    } finally {
      setSaving(false);
      if (didSave) closePanel();
    }
  }

  async function runAdminOperation(operation: () => Promise<void>) {
    setAdminDataSaving(true);
    setAdminDataMessage(null);
    setAdminDataMessageTone("info");
    setError(null);
    try {
      await operation();
    } catch (adminError) {
      setAdminDataError(adminError instanceof Error ? adminError.message : "Admin action failed.");
    } finally {
      setAdminDataSaving(false);
    }
  }

  function setAdminDataInfo(message: string) {
    setAdminDataMessageTone("info");
    setAdminDataMessage(message);
  }

  function setAdminDataError(message: string) {
    setAdminDataMessageTone("error");
    setAdminDataMessage(message);
    // Mirror to the always-visible top pill so non-admins (who have no admin
    // panel) still see failures from editing/deleting their own map items.
    setError(message);
  }

  async function updateTrip(input: { title: string; description: string | null; start_date: string | null; end_date: string | null }) {
    if (!data.trip) return;
    await runAdminOperation(async () => {
      if (supabase) {
        const { error: updateError } = await supabase.from("trips").update(input).eq("id", data.trip!.id);
        if (updateError) setAdminDataError(updateError.message);
        else {
          setAdminDataInfo("Trip updated.");
          await loadData();
        }
      } else {
        setData((current) => ({ ...current, trip: current.trip ? { ...current.trip, ...input } : current.trip }));
        setAdminDataInfo("Trip updated.");
      }
    });
  }

  async function updateDay(dayId: string, input: { day_number: number; date: string | null; title: string | null; summary: string | null }) {
    if (!data.trip) return;
    await runAdminOperation(async () => {
      if (supabase) {
        const { error: updateError } = await supabase.from("days").update(input).eq("id", dayId).eq("trip_id", data.trip!.id);
        if (updateError) setAdminDataError(updateError.message);
        else {
          setAdminDataInfo("Day updated.");
          await loadData();
        }
      } else {
        setData((current) => ({ ...current, days: current.days.map((day) => day.id === dayId ? { ...day, ...input } : day).sort((a, b) => a.day_number - b.day_number) }));
        setAdminDataInfo("Day updated.");
      }
    });
  }

  async function createDay(input: { day_number: number; date: string | null; title: string | null; summary: string | null }) {
    if (!data.trip) return;
    await runAdminOperation(async () => {
      const row = { ...input, trip_id: data.trip!.id };
      if (supabase) {
        const { error: insertError } = await supabase.from("days").insert(row);
        if (insertError) setAdminDataError(insertError.message);
        else {
          setAdminDataInfo("Day added.");
          await loadData();
        }
      } else {
        setData((current) => ({
          ...current,
          days: [...current.days, { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }].sort((a, b) => a.day_number - b.day_number),
        }));
        setAdminDataInfo("Day added.");
      }
    });
  }

  async function importGpx(file: File) {
    if (!data.trip) return;
    const tripId = data.trip.id;
    if (supabase && !isAdmin) {
      setAdminDataError("Only trip admins can import GPX files.");
      return;
    }
    if (supabase && !user) {
      setAdminDataError("Sign in before importing GPX files to Supabase.");
      return;
    }

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

        const row = {
          trip_id: tripId,
          day_number: nextDayNumber++,
          date,
          title: `GPX import ${date}`,
          summary: null,
        };

        if (supabase) {
          const { data: insertedDay, error: insertError } = await supabase.from("days").insert(row).select("*").single();
          if (insertError) throw new Error(insertError.message);
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

      if (supabase) {
        if (routeRows.length > 0) {
          const { error: routeError } = await supabase.from("route_segments").insert(routeRows);
          if (routeError) throw new Error(routeError.message);
        }
        if (noteRows.length > 0) {
          const { error: noteError } = await supabase.from("notes").insert(noteRows);
          if (noteError) throw new Error(noteError.message);
        }
        setAdminDataInfo(`Imported ${routeRows.length} route${routeRows.length === 1 ? "" : "s"} and ${noteRows.length} waypoint${noteRows.length === 1 ? "" : "s"}.`);
        await loadData();
        return;
      }

      const now = new Date().toISOString();
      setData((current) => ({
        ...current,
        days: [...current.days, ...createdLocalDays].sort((a, b) => a.day_number - b.day_number),
        routeSegments: [
          ...current.routeSegments,
          ...routeRows.map((row) => ({ ...row, id: crypto.randomUUID(), created_at: now })),
        ],
        notes: [
          ...noteRows.map((row) => ({ ...row, id: crypto.randomUUID(), created_at: now })),
          ...current.notes,
        ],
      }));
      setAdminDataInfo(`Imported ${routeRows.length} route${routeRows.length === 1 ? "" : "s"} and ${noteRows.length} waypoint${noteRows.length === 1 ? "" : "s"}.`);
    });
  }

  async function updateRoute(routeId: string, input: { day_id: string | null; name: string | null; mode: RouteMode; source: string | null }) {
    if (!data.trip) return;
    await runAdminOperation(async () => {
      if (supabase) {
        const { error: updateError } = await supabase.from("route_segments").update(input).eq("id", routeId).eq("trip_id", data.trip!.id);
        if (updateError) setAdminDataError(updateError.message);
        else {
          setAdminDataInfo("Route updated.");
          await loadData();
        }
      } else {
        setData((current) => ({ ...current, routeSegments: current.routeSegments.map((route) => route.id === routeId ? { ...route, ...input } : route) }));
        setAdminDataInfo("Route updated.");
      }
    });
  }

  async function updateNote(noteId: string, input: { day_id: string | null; author_name: string | null; body: string }) {
    if (!data.trip) return;
    await runAdminOperation(async () => {
      if (supabase) {
        const { error: updateError } = await supabase.from("notes").update(input).eq("id", noteId).eq("trip_id", data.trip!.id);
        if (updateError) setAdminDataError(updateError.message);
        else {
          setAdminDataInfo("Note updated.");
          await loadData();
        }
      } else {
        setData((current) => ({ ...current, notes: current.notes.map((note) => note.id === noteId ? { ...note, ...input } : note) }));
        setAdminDataInfo("Note updated.");
      }
    });
  }

  async function updatePlace(placeId: string, input: { day_id: string | null; name: string; place_type: string | null; description: string | null; lat: number; lng: number }) {
    if (!data.trip) return;
    await runAdminOperation(async () => {
      if (supabase) {
        const { error: updateError } = await supabase.from("places").update(input).eq("id", placeId).eq("trip_id", data.trip!.id);
        if (updateError) setAdminDataError(updateError.message);
        else {
          setAdminDataInfo("Place updated.");
          await loadData();
        }
      } else {
        setData((current) => ({ ...current, places: current.places.map((place) => place.id === placeId ? { ...place, ...input } : place) }));
        setAdminDataInfo("Place updated.");
      }
    });
  }

  async function updatePhoto(photoId: string, input: { day_id: string | null; uploader_name: string | null; caption: string | null; lat: number | null; lng: number | null; taken_at: string | null }) {
    if (!data.trip) return;
    await runAdminOperation(async () => {
      if (supabase) {
        const { error: updateError } = await supabase.from("photos").update(input).eq("id", photoId).eq("trip_id", data.trip!.id);
        if (updateError) setAdminDataError(updateError.message);
        else {
          setAdminDataInfo("Photo updated.");
          await loadData();
        }
      } else {
        setData((current) => ({ ...current, photos: current.photos.map((photo) => photo.id === photoId ? { ...photo, ...input } : photo) }));
        setAdminDataInfo("Photo updated.");
      }
    });
  }

  async function deleteDataItem(table: "days" | "route_segments" | "notes" | "places" | "photos", id: string) {
    if (!data.trip) return;
    await runAdminOperation(async () => {
      if (supabase) {
        const photoToDelete = table === "photos" ? data.photos.find((photo) => photo.id === id) : null;
        const photoStoragePaths = photoToDelete
          ? [photoToDelete.image_path, photoToDelete.thumbnail_path].filter((path): path is string => Boolean(path))
          : [];
        const { error: deleteError } = await supabase.from(table).delete().eq("id", id).eq("trip_id", data.trip!.id);
        if (deleteError) setAdminDataError(deleteError.message);
        else {
          if (table === "days") setSelectedDayId((current) => current === id ? null : current);
          if (photoStoragePaths.length > 0) {
            const { error: storageDeleteError } = await supabase.storage.from(PHOTO_BUCKET).remove(photoStoragePaths);
            if (storageDeleteError) setAdminDataError(`Item deleted, but photo file cleanup failed: ${storageDeleteError.message}`);
            else setAdminDataInfo("Item deleted.");
          } else {
            setAdminDataInfo("Item deleted.");
          }
          await loadData();
        }
      } else {
        const deletedPhoto = table === "photos" ? data.photos.find((item) => item.id === id) : null;
        if (deletedPhoto?.image_url?.startsWith("blob:")) URL.revokeObjectURL(deletedPhoto.image_url);
        if (deletedPhoto?.thumbnail_url?.startsWith("blob:")) URL.revokeObjectURL(deletedPhoto.thumbnail_url);
        if (table === "days") setSelectedDayId((current) => current === id ? null : current);
        setData((current) => ({
          ...current,
          days: table === "days" ? current.days.filter((item) => item.id !== id) : current.days,
          notes: table === "notes" ? current.notes.filter((item) => item.id !== id) : current.notes.map((item) => table === "days" && item.day_id === id ? { ...item, day_id: null } : item),
          places: table === "places" ? current.places.filter((item) => item.id !== id) : current.places.map((item) => table === "days" && item.day_id === id ? { ...item, day_id: null } : item),
          photos: table === "photos" ? current.photos.filter((item) => item.id !== id) : current.photos.map((item) => table === "days" && item.day_id === id ? { ...item, day_id: null } : item),
          routeSegments: table === "route_segments"
            ? current.routeSegments.filter((item) => item.id !== id)
            : current.routeSegments.map((item) => table === "days" && item.day_id === id ? { ...item, day_id: null } : item),
        }));
        setAdminDataInfo("Item deleted.");
      }
    });
  }

  return (
    <main className="relative h-dvh overflow-hidden bg-[#e7efe8] text-stone-950">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,253,246,0.92),rgba(211,229,222,0.5)_44%,rgba(234,198,132,0.26))]" />
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 px-3 py-3 md:px-6">
        <div className="pointer-events-auto flex max-w-[min(18rem,calc(100vw-11rem))] items-center gap-2 rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] px-4 py-2 text-sm font-black shadow-lg backdrop-blur sm:max-w-none">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#d0872f]" /> <span className="truncate">{tripTitle}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="pointer-events-auto hidden rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] px-4 py-2 text-xs font-semibold text-stone-700 shadow-lg backdrop-blur sm:block">{supabase ? (user ? `Signed in ${user.email ?? ""}` : "Viewing as guest") : "Local demo mode"}</div>
          <button
            onClick={() => journeyItems[0] && openJourneyAt(journeyItems[0].id)}
            disabled={journeyItems.length === 0}
            aria-label="Open Journey Mode"
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-[#e7a13d] px-3 py-2 text-xs font-black text-stone-950 shadow-lg transition hover:bg-[#f0ae4b] hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5 fill-current" /> <span className="hidden sm:inline">Journey</span>
          </button>
          {supabase && user && currentMember && profilesAvailable ? (
            <button onClick={() => setProfilePanelOpen(true)} aria-label="Edit your profile" className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] py-1 pl-1 pr-3 text-xs font-bold text-stone-700 shadow-lg backdrop-blur transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.97]">
              <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-stone-200">
                {currentMember.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={currentMember.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UserRound className="h-3.5 w-3.5 text-stone-500" />
                )}
              </span>
              <span className="hidden sm:inline">Profile</span>
            </button>
          ) : null}
          {supabase && user ? <button onClick={signOut} className="pointer-events-auto rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] px-3 py-2 text-xs font-bold text-stone-700 shadow-lg backdrop-blur transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.97]">Sign out</button> : null}
          {supabase && !authLoading && !user ? <button onClick={() => setAuthPanelOpen(true)} className="pointer-events-auto rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] px-3 py-2 text-xs font-bold text-stone-700 shadow-lg backdrop-blur transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.97]">Sign in</button> : null}
        </div>
      </div>
      <div className="relative z-10 grid h-full gap-4 p-0 md:grid-cols-[24rem_minmax(0,1fr)] md:p-4 md:pt-[4.5rem]">
        <div className="z-10 hidden min-h-0 md:block"><DaySidebar trip={data.trip} days={data.days} selectedDayId={selectedDayId} onSelectDay={setSelectedDayId} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} showLayerControls={mapActionsEnabled} onStartPhotoUpload={canContribute && mapActionsEnabled ? () => startPanel("photo") : undefined} onStartAddNote={canContribute && mapActionsEnabled ? () => startPanel("note") : undefined} onStartRouteDraw={isAdmin && mapActionsEnabled ? () => startPanel("route") : undefined} adminData={adminData} memberAdmin={memberAdmin} adminRequest={adminRequest} /></div>
        <div className={cn("h-full min-h-0", journeyOpen && "hidden")}>
          <MapView clickMode={clickMode} pendingCoordinate={pendingCoordinate} onMapReady={handleMapReady} onMapUnavailable={handleMapUnavailable} onCoordinatePick={handleCoordinatePick}>
            {!mapUnavailable ? <TripLayers map={map} routes={filtered.routes} photos={filtered.photos} notes={filtered.notes} places={filtered.places} visibility={layerVisibility} currentUserId={currentUserId} isAdmin={isAdmin} onEditItem={startEditFromMap} onDeleteItem={deleteFromMap} onOpenJourney={openJourneyFromMap} /> : null}
            {!mapUnavailable ? <RouteDraftLayer map={map} points={routeDraftPoints} /> : null}
            {!mapUnavailable ? <MapLegend visibility={layerVisibility} /> : null}
          </MapView>
        </div>
      </div>
      {!panel ? <MobileSheet trip={data.trip} days={data.days} selectedDayId={selectedDayId} onSelectDay={setSelectedDayId} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} showLayerControls={mapActionsEnabled} mapAvailable={mapActionsEnabled} onStartPhotoUpload={canContribute && mapActionsEnabled ? () => startPanel("photo") : undefined} onStartAddNote={canContribute && mapActionsEnabled ? () => startPanel("note") : undefined} onStartRouteDraw={isAdmin && mapActionsEnabled ? () => startPanel("route") : undefined} counts={{ routes: filtered.routes.length, photos: filtered.photos.length, notes: filtered.notes.length, places: filtered.places.length }} adminData={adminData} memberAdmin={memberAdmin} adminRequest={adminRequest} /> : null}
      {loading ? <StatusPill><Loader2 className="h-4 w-4 animate-spin text-teal-700" /> Loading trip data…</StatusPill> : null}
      {notice && !error ? <StatusPill onDismiss={() => setNotice(null)}>{notice}</StatusPill> : null}
      {error ? <StatusPill tone="error" onDismiss={() => setError(null)}><AlertCircle className="h-4 w-4 shrink-0 text-rose-600" /> {error}</StatusPill> : null}
      {supabase && !authLoading && !user && authPanelOpen ? <AuthPanel message={authMessage} messageTone={authMessageTone} isSubmitting={authSubmitting} onSignIn={signIn} onSignInWithGoogle={signInWithGoogle} onClose={() => setAuthPanelOpen(false)} /> : null}
      {supabase && user && currentMember && profilesAvailable && profilePanelOpen ? <ProfilePanel displayName={currentMember.display_name} avatarUrl={currentMember.avatar_url} email={user.email ?? null} isSaving={profileSaving} onClose={() => setProfilePanelOpen(false)} onSave={saveProfile} /> : null}
      {panel === "note" ? <AddNotePanel days={data.days} selectedCoordinate={pendingCoordinate} defaultDayId={selectedDayId} isSaving={saving} onCancel={closePanel} onSave={saveNote} /> : null}
      {panel === "photo" ? <UploadPhotoPanel days={data.days} routes={data.routeSegments} defaultDayId={selectedDayId} pendingCoordinate={pendingCoordinate} isSaving={saving} onCancel={closePanel} onCoordinatePreview={setPendingCoordinate} onSave={savePhotos} /> : null}
      {panel === "route" ? <ManualRoutePanel days={data.days} defaultDayId={selectedDayId} points={routeDraftPoints} distanceMeters={routeDraftDistance} isSaving={saving} onCancel={closePanel} onUndoPoint={() => setRouteDraftPoints((current) => current.slice(0, -1))} onClear={() => setRouteDraftPoints([])} onSave={saveRoute} /> : null}
      {editTarget ? <EditItemPanel target={editTarget} days={data.days} isSaving={adminDataSaving} onClose={() => setEditTargetRef(null)} onUpdatePhoto={updatePhoto} onUpdateNote={updateNote} onUpdatePlace={updatePlace} onUpdateRoute={updateRoute} onDeleteItem={deleteDataItem} /> : null}
      {journeyOpen ? (
        <JourneyPlayback
          items={journeyItems}
          allItems={allJourneyItems}
          activeIndex={Math.max(0, activeJourneyIndex)}
          days={data.days}
          routes={data.routeSegments}
          filter={journeyFilter}
          uploaderFilter={journeyUploaderFilter}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          isSaving={adminDataSaving}
          onFilterChange={setJourneyFilter}
          onUploaderFilterChange={setJourneyUploaderFilter}
          onSelectIndex={selectJourneyIndex}
          onSelectItem={selectJourneyItem}
          onNext={nextJourneyItem}
          onPrev={prevJourneyItem}
          onClose={closeJourney}
          onUpdatePhoto={updatePhoto}
        />
      ) : null}
    </main>
  );
}

function StatusPill({ children, tone = "info", onDismiss }: { children: ReactNode; tone?: "info" | "error"; onDismiss?: () => void }) {
  return (
    <div
      role="status"
      className={cn(
        "fixed left-1/2 top-16 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-xl backdrop-blur",
        tone === "error" ? "border-rose-200 bg-rose-50/95 text-rose-900" : "border-stone-200/80 bg-[rgba(255,253,246,0.94)] text-stone-800",
      )}
    >
      {children}
      {onDismiss ? <button onClick={onDismiss} className="-mr-1 ml-1 rounded-full p-1 text-current/70 transition hover:bg-stone-900/10" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button> : null}
    </div>
  );
}

function AuthPanel({ message, messageTone, isSubmitting, onSignIn, onSignInWithGoogle, onClose }: { message: string | null; messageTone: "info" | "error"; isSubmitting: boolean; onSignIn: (email: string) => Promise<void>; onSignInWithGoogle: () => Promise<void>; onClose: () => void }) {
  async function submit(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    if (email) await onSignIn(email);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <form action={submit} onClick={(event) => event.stopPropagation()} className="relative w-full max-w-md rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.97)] p-5 text-stone-950 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1.5 text-stone-500 transition hover:bg-stone-900/10 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50"><X className="h-4 w-4" /></button>
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-teal-50 p-3 text-teal-800"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <h2 className="font-serif text-2xl font-semibold">Sign in to Lofoten</h2>
            <p className="text-sm leading-6 text-stone-600">Viewing is open to everyone — sign in with an invited account to add or edit.</p>
          </div>
        </div>
        <button type="button" disabled={isSubmitting} onClick={onSignInWithGoogle} className="mb-4 flex w-full items-center justify-center gap-3 rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-black text-stone-900 shadow-sm transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Continue with Google
        </button>
        <div className="mb-4 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.12em] text-stone-400">
          <span className="h-px flex-1 bg-stone-200" /> Or use email <span className="h-px flex-1 bg-stone-200" />
        </div>
        <label className="mb-3 block text-sm font-bold text-stone-800" htmlFor="email">Email</label>
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-3">
          <Mail className="h-4 w-4 text-teal-800" />
          <input id="email" name="email" type="email" required placeholder="you@example.com" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400" />
        </div>
        {message ? (
          <div
            className={cn(
              "mb-3 rounded-lg border p-3 text-sm",
              messageTone === "error" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-teal-700/20 bg-teal-50 text-teal-950",
            )}
          >
            {message}
          </div>
        ) : null}
        <button disabled={isSubmitting} className="w-full rounded-lg bg-[#e7a13d] px-4 py-3 font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
          {isSubmitting ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <LogIn className="mr-2 inline h-4 w-4" />} Send sign-in link
        </button>
      </form>
    </div>
  );
}
