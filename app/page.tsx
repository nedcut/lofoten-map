"use client";

import dynamic from "next/dynamic";
import mapboxgl from "mapbox-gl";
import { length } from "@turf/turf";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LineString } from "geojson";
import type { User } from "@supabase/supabase-js";
import { AlertCircle, Loader2, LogIn, Mail, ShieldCheck, Sparkles, X } from "lucide-react";
import { AddNotePanel } from "@/components/AddNotePanel";
import { DaySidebar } from "@/components/DaySidebar";
import { ManualRoutePanel } from "@/components/ManualRoutePanel";
import { MapLegend } from "@/components/MapLegend";
import { MobileSheet } from "@/components/MobileSheet";
import { RouteDraftLayer } from "@/components/RouteDraftLayer";
import { TripLayers, type MapItemKind } from "@/components/TripLayers";
import { EditItemPanel, type EditTarget } from "@/components/EditItemPanel";
import { UploadPhotoPanel, type PhotoUploadItemInput, type PhotoUploadSaveResult } from "@/components/UploadPhotoPanel";
import { deriveTripAccess } from "@/lib/access";
import { preparePhotoFiles } from "@/lib/photo-processing";
import { PHOTO_BUCKET, getSupabaseBrowserClient, resolvePhotoUrls } from "@/lib/supabase";
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

type SectionError = { code?: string; message: string } | null | undefined;

function isMissingAdminRequestsTable(error: SectionError) {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return message.includes("admin_requests") && (message.includes("schema cache") || message.includes("could not find the table"));
}

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
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminRequestsAvailable, setAdminRequestsAvailable] = useState(true);

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
        supabase.from("trip_members").select("trip_id,user_id,role,display_name,created_at").eq("trip_id", trip.id).order("created_at"),
        adminRequestsQuery,
      ]);
      const adminRequestsMissing = isMissingAdminRequestsTable(adminRequests.error);
      setAdminRequestsAvailable(!adminRequestsMissing);
      if (adminRequestsMissing) {
        setNotice("Admin access requests are temporarily unavailable. Re-run supabase/schema.sql in Supabase, then refresh.");
      }
      const failure = [days.error, routes.error, photos.error, notes.error, places.error, members.error, adminRequestsMissing ? null : adminRequests.error].find(Boolean);
      if (failure) {
        setError(`The trip loaded, but one section could not sync. Try refreshing. ${failure.message}`);
      } else {
        const resolvedPhotos = resolvePhotoUrls(supabase, (photos.data ?? []) as Photo[]);
        setData({ trip, days: days.data ?? [], routeSegments: (routes.data ?? []) as RouteSegment[], photos: resolvedPhotos, notes: notes.data ?? [], places: places.data ?? [], members: (members.data ?? []) as TripMember[], adminRequests: adminRequestsMissing ? [] : (adminRequests.data ?? []) as AdminRequest[] });
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
    }
    : null;

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

  async function savePhotos(inputs: PhotoUploadItemInput[]): Promise<PhotoUploadSaveResult | void> {
    if (inputs.length === 0 || !data.trip) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    // Uploader is the signed-in user — no name field needed in the upload flow.
    const uploaderName = currentMember?.display_name || user?.email || "Friend";
    let didSave = false;
    const savedClientIds: string[] = [];
    const failedClientIds: string[] = [];
    try {
      if (!supabase) {
        const rows = await Promise.all(inputs.map(async (input) => {
          const prepared = await preparePhotoFiles(input.file);
          return {
            id: crypto.randomUUID(),
            trip_id: data.trip!.id,
            day_id: input.dayId,
            user_id: user?.id ?? null,
            uploader_name: uploaderName,
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

        await mapWithConcurrency(inputs, UPLOAD_CONCURRENCY, async (input) => {
          const prepared = await preparePhotoFiles(input.file);
          const extension = fileExtension(prepared.imageFile);
          const path = `${data.trip!.slug}/${crypto.randomUUID()}.${extension}`;
          const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, prepared.imageFile, { cacheControl: "3600", upsert: false, contentType: prepared.imageFile.type || undefined });
          if (uploadError) {
            failures.push(`${input.file.name}: ${uploadError.message}`);
            failedClientIds.push(input.clientId);
            return;
          }
          uploadedPaths.push(path);
          let thumbnailStoragePath: string | null = null;
          if (prepared.thumbnailFile) {
            const thumbnailPath = `${data.trip!.slug}/thumbs/${crypto.randomUUID()}.jpg`;
            const { error: thumbnailError } = await supabase.storage.from(PHOTO_BUCKET).upload(thumbnailPath, prepared.thumbnailFile, { cacheControl: "3600", upsert: false, contentType: prepared.thumbnailFile.type });
            if (thumbnailError) {
              warnings.push(`${input.file.name}: thumbnail skipped`);
            } else {
              uploadedPaths.push(thumbnailPath);
              thumbnailStoragePath = thumbnailPath;
            }
          }
          rows.push({
            client_id: input.clientId,
            trip_id: data.trip!.id,
            day_id: input.dayId,
            uploader_name: uploaderName,
            image_path: path,
            thumbnail_path: thumbnailStoragePath,
            lat: input.coordinate.lat,
            lng: input.coordinate.lng,
            taken_at: input.exif?.takenAt,
            caption: input.caption,
            exif_found: input.exif?.exifFound ?? false,
          });
        });

        if (rows.length > 0) {
          const insertRows = rows.map((row) => ({
            trip_id: row.trip_id,
            day_id: row.day_id,
            uploader_name: row.uploader_name,
            image_path: row.image_path,
            thumbnail_path: row.thumbnail_path,
            lat: row.lat,
            lng: row.lng,
            taken_at: row.taken_at,
            caption: row.caption,
            exif_found: row.exif_found,
          }));
          const { error: insertError } = await supabase.from("photos").insert(insertRows);
          if (insertError) {
            if (uploadedPaths.length > 0) await supabase.storage.from(PHOTO_BUCKET).remove(uploadedPaths);
            setError(insertError.message);
            failedClientIds.push(...rows.map((row) => row.client_id));
          } else {
            savedClientIds.push(...rows.map((row) => row.client_id));
            await loadData();
            didSave = true;
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
          {supabase && user ? <button onClick={signOut} className="pointer-events-auto rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] px-3 py-2 text-xs font-bold text-stone-700 shadow-lg backdrop-blur transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.97]">Sign out</button> : null}
          {supabase && !authLoading && !user ? <button onClick={() => setAuthPanelOpen(true)} className="pointer-events-auto rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] px-3 py-2 text-xs font-bold text-stone-700 shadow-lg backdrop-blur transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.97]">Sign in</button> : null}
        </div>
      </div>
      <div className="relative z-10 grid h-full gap-4 p-0 md:grid-cols-[24rem_minmax(0,1fr)] md:p-4 md:pt-[4.5rem]">
        <div className="z-10 hidden min-h-0 md:block"><DaySidebar trip={data.trip} days={data.days} selectedDayId={selectedDayId} onSelectDay={setSelectedDayId} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} showLayerControls={mapActionsEnabled} onStartPhotoUpload={canContribute && mapActionsEnabled ? () => startPanel("photo") : undefined} onStartAddNote={canContribute && mapActionsEnabled ? () => startPanel("note") : undefined} onStartRouteDraw={isAdmin && mapActionsEnabled ? () => startPanel("route") : undefined} adminData={adminData} memberAdmin={memberAdmin} adminRequest={adminRequest} /></div>
        <MapView clickMode={clickMode} pendingCoordinate={pendingCoordinate} onMapReady={handleMapReady} onMapUnavailable={handleMapUnavailable} onCoordinatePick={handleCoordinatePick}>
          {!mapUnavailable ? <TripLayers map={map} routes={filtered.routes} photos={filtered.photos} notes={filtered.notes} places={filtered.places} visibility={layerVisibility} currentUserId={currentUserId} isAdmin={isAdmin} onEditItem={startEditFromMap} onDeleteItem={deleteFromMap} /> : null}
          {!mapUnavailable ? <RouteDraftLayer map={map} points={routeDraftPoints} /> : null}
          {!mapUnavailable ? <MapLegend visibility={layerVisibility} /> : null}
        </MapView>
      </div>
      {!panel ? <MobileSheet trip={data.trip} days={data.days} selectedDayId={selectedDayId} onSelectDay={setSelectedDayId} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} showLayerControls={mapActionsEnabled} mapAvailable={mapActionsEnabled} onStartPhotoUpload={canContribute && mapActionsEnabled ? () => startPanel("photo") : undefined} onStartAddNote={canContribute && mapActionsEnabled ? () => startPanel("note") : undefined} onStartRouteDraw={isAdmin && mapActionsEnabled ? () => startPanel("route") : undefined} counts={{ routes: filtered.routes.length, photos: filtered.photos.length, notes: filtered.notes.length, places: filtered.places.length }} adminData={adminData} memberAdmin={memberAdmin} adminRequest={adminRequest} /> : null}
      {loading ? <StatusPill><Loader2 className="h-4 w-4 animate-spin text-teal-700" /> Loading trip data…</StatusPill> : null}
      {notice && !error ? <StatusPill onDismiss={() => setNotice(null)}>{notice}</StatusPill> : null}
      {error ? <StatusPill tone="error" onDismiss={() => setError(null)}><AlertCircle className="h-4 w-4 shrink-0 text-rose-600" /> {error}</StatusPill> : null}
      {supabase && !authLoading && !user && authPanelOpen ? <AuthPanel message={authMessage} messageTone={authMessageTone} isSubmitting={authSubmitting} onSignIn={signIn} onSignInWithGoogle={signInWithGoogle} onClose={() => setAuthPanelOpen(false)} /> : null}
      {panel === "note" ? <AddNotePanel days={data.days} selectedCoordinate={pendingCoordinate} defaultDayId={selectedDayId} isSaving={saving} onCancel={closePanel} onSave={saveNote} /> : null}
      {panel === "photo" ? <UploadPhotoPanel days={data.days} routes={data.routeSegments} defaultDayId={selectedDayId} pendingCoordinate={pendingCoordinate} isSaving={saving} onCancel={closePanel} onCoordinatePreview={setPendingCoordinate} onSave={savePhotos} /> : null}
      {panel === "route" ? <ManualRoutePanel days={data.days} defaultDayId={selectedDayId} points={routeDraftPoints} distanceMeters={routeDraftDistance} isSaving={saving} onCancel={closePanel} onUndoPoint={() => setRouteDraftPoints((current) => current.slice(0, -1))} onClear={() => setRouteDraftPoints([])} onSave={saveRoute} /> : null}
      {editTarget ? <EditItemPanel target={editTarget} days={data.days} isSaving={adminDataSaving} onClose={() => setEditTargetRef(null)} onUpdatePhoto={updatePhoto} onUpdateNote={updateNote} onUpdatePlace={updatePlace} onUpdateRoute={updateRoute} onDeleteItem={deleteDataItem} /> : null}
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
