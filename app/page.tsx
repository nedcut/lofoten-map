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
import { TripLayers } from "@/components/TripLayers";
import { UploadPhotoPanel, type PhotoUploadItemInput } from "@/components/UploadPhotoPanel";
import { PHOTO_BUCKET, getSupabaseBrowserClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Day, LngLat, MapClickMode, Note, Place, RouteMode, RouteSegment, Trip, TripData, TripMember } from "@/types/trip";

const MapView = dynamic(() => import("@/components/MapView").then((mod) => mod.MapView), { ssr: false });

const demoTripId = "00000000-0000-4000-8000-000000000001";
const demoDays: Day[] = [
  { id: "00000000-0000-4000-8000-000000000101", trip_id: demoTripId, day_number: 1, date: "2026-07-12", title: "Reine arrival", summary: "Settle in, ferry views, and first village walk.", created_at: new Date().toISOString() },
  { id: "00000000-0000-4000-8000-000000000102", trip_id: demoTripId, day_number: 2, date: "2026-07-13", title: "Kjerkfjorden hike", summary: "Trail day toward fjord viewpoints.", created_at: new Date().toISOString() },
  { id: "00000000-0000-4000-8000-000000000103", trip_id: demoTripId, day_number: 3, date: "2026-07-14", title: "Moskenes coast", summary: "Weather window, photo stops, and camp scouting.", created_at: new Date().toISOString() },
];
const demoTrip: Trip = { id: demoTripId, title: "Lofoten 2026", slug: "lofoten-2026", description: "A shared Lofoten hiking logbook.", start_date: "2026-07-12", end_date: "2026-07-18", created_at: new Date().toISOString() };
const demoRoutes: RouteSegment[] = [{ id: "route-demo", trip_id: demoTripId, day_id: demoDays[1].id, name: "Reine to Kjerkfjorden scouting route", source: "seed", mode: "hike", geometry_geojson: { type: "LineString", coordinates: [[13.089, 67.932], [13.068, 67.941], [13.045, 67.954], [13.019, 67.967]] }, distance_meters: 6200, elevation_gain_meters: 420, created_at: new Date().toISOString() }];
const demoNotes: Note[] = [{ id: "note-demo-1", trip_id: demoTripId, day_id: demoDays[0].id, author_name: "Maja", lat: 67.9328, lng: 13.0888, body: "Sunset light on Reinebringen looked unreal from the harbor.", note_type: "note", created_at: new Date().toISOString() }];
const demoPlaces: Place[] = [{ id: "place-demo-1", trip_id: demoTripId, day_id: demoDays[2].id, name: "Coffee and cinnamon buns", lat: 67.9007, lng: 13.0461, place_type: "food", description: "Good meetup stop before the ferry.", created_at: new Date().toISOString() }];
const demoData: TripData = { trip: demoTrip, days: demoDays, routeSegments: demoRoutes, photos: [], notes: demoNotes, places: demoPlaces, members: [] };
const emptyData: TripData = { trip: null, days: [], routeSegments: [], photos: [], notes: [], places: [], members: [] };
const UPLOAD_CONCURRENCY = 4;

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

export default function Home() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [data, setData] = useState<TripData>(() => (supabase ? emptyData : demoData));
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [memberMessage, setMemberMessage] = useState<string | null>(null);
  const [memberSaving, setMemberSaving] = useState(false);
  const [adminDataMessage, setAdminDataMessage] = useState<string | null>(null);
  const [adminDataSaving, setAdminDataSaving] = useState(false);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [layerVisibility, setLayerVisibility] = useState({ photos: true, notes: true, routes: true });
  const [clickMode, setClickMode] = useState<MapClickMode>("idle");
  const [pendingCoordinate, setPendingCoordinate] = useState<LngLat | null>(null);
  const [routeDraftPoints, setRouteDraftPoints] = useState<LngLat[]>([]);
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [panel, setPanel] = useState<"photo" | "note" | "route" | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);

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
      if (!session?.user) setData(emptyData);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const loadData = useCallback(async () => {
    if (!supabase || !user) return;
    setLoading(true);
    setError(null);
    const { data: trip, error: tripError } = await supabase.from("trips").select("*").eq("slug", tripSlug).maybeSingle();
    if (tripError || !trip) {
      setError(tripError ? `Supabase could not load this trip: ${tripError.message}` : "Supabase could not find this trip. Run schema/seed SQL, then add your signed-in user to trip_members.");
      setLoading(false);
      return;
    }
    const [days, routes, photos, notes, places, members] = await Promise.all([
      supabase.from("days").select("*").eq("trip_id", trip.id).order("day_number"),
      supabase.from("route_segments").select("*").eq("trip_id", trip.id).order("created_at"),
      supabase.from("photos").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
      supabase.from("notes").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
      supabase.from("places").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
      supabase.from("trip_members").select("trip_id,user_id,role,display_name,created_at").eq("trip_id", trip.id).order("created_at"),
    ]);
    const failure = [days.error, routes.error, photos.error, notes.error, places.error, members.error].find(Boolean);
    if (failure) setError(failure.message);
    else setData({ trip, days: days.data ?? [], routeSegments: (routes.data ?? []) as RouteSegment[], photos: photos.data ?? [], notes: notes.data ?? [], places: places.data ?? [], members: (members.data ?? []) as TripMember[] });
    setLoading(false);
  }, [supabase, tripSlug, user]);

  useEffect(() => {
    if (!supabase) return;
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    loadData();
  }, [authLoading, loadData, supabase, user]);

  useEffect(() => {
    if (!supabase || !data.trip || !user) return;
    const channel = supabase
      .channel("lofoten-logbook-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "photos", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "route_segments", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "places", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [data.trip, loadData, supabase, user]);

  async function signIn(email: string) {
    if (!supabase) return;
    setAuthSubmitting(true);
    setAuthMessage(null);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setAuthMessage(signInError ? signInError.message : "Check your email for a sign-in link.");
    setAuthSubmitting(false);
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    setAuthSubmitting(true);
    setAuthMessage(null);
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (signInError) {
      setAuthMessage(signInError.message);
      setAuthSubmitting(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setData(emptyData);
  }

  async function grantMember(input: { email: string; role: "admin" | "member" }) {
    if (!supabase || !data.trip) return;
    setMemberSaving(true);
    setMemberMessage(null);
    const { error: grantError } = await supabase.rpc("grant_trip_member_by_email", {
      target_trip_slug: data.trip.slug,
      target_email: input.email,
      target_role: input.role,
    });
    if (grantError) {
      setMemberMessage(grantError.message);
    } else {
      setMemberMessage(`${input.email} added as ${input.role}.`);
      await loadData();
    }
    setMemberSaving(false);
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

  const currentMember = useMemo(() => data.members.find((member) => member.user_id === user?.id) ?? null, [data.members, user?.id]);
  const isAdmin = !supabase || currentMember?.role === "admin";
  const memberAdmin = currentMember?.role === "admin"
    ? { members: data.members, message: memberMessage, isSaving: memberSaving, onGrantMember: grantMember }
    : null;
  const routeDraftDistance = useMemo(() => routeDistanceMeters(routeDraftPoints), [routeDraftPoints]);
  const adminData = isAdmin
    ? {
      trip: data.trip,
      days: data.days,
      routes: data.routeSegments,
      notes: data.notes,
      places: data.places,
      photos: data.photos,
      message: adminDataMessage,
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

  function startPanel(next: "photo" | "note" | "route") {
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

  async function saveNote(input: { body: string; authorName: string; dayId: string | null }) {
    if (!pendingCoordinate || !input.body || !data.trip) return;
    setSaving(true);
    const row = { trip_id: data.trip.id, day_id: input.dayId, author_name: input.authorName || "Friend", lat: pendingCoordinate.lat, lng: pendingCoordinate.lng, body: input.body, note_type: "note" };
    if (supabase) {
      if (!user) {
        setError("Sign in before saving notes to Supabase.");
        setSaving(false);
        return;
      }
      const { error: insertError } = await supabase.from("notes").insert(row);
      if (insertError) setError(insertError.message);
      else await loadData();
    } else {
      setData((current) => ({ ...current, notes: [{ ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...current.notes] }));
    }
    setSaving(false);
    closePanel();
  }

  async function savePhotos(inputs: PhotoUploadItemInput[]) {
    if (inputs.length === 0 || !data.trip) return;
    setSaving(true);
    if (!supabase) {
      const rows = inputs.map((input) => ({
        id: crypto.randomUUID(),
        trip_id: data.trip!.id,
        day_id: input.dayId,
        uploader_name: input.uploaderName || "Friend",
        image_url: URL.createObjectURL(input.file),
        thumbnail_url: null,
        lat: input.coordinate.lat,
        lng: input.coordinate.lng,
        taken_at: input.exif?.takenAt ?? null,
        caption: input.caption,
        exif_found: input.exif?.exifFound ?? false,
        created_at: new Date().toISOString(),
      }));
      setData((current) => ({ ...current, photos: [...rows, ...current.photos] }));
    } else {
      if (!user) {
        setError("Sign in before uploading photos to Supabase.");
        setSaving(false);
        return;
      }
      const rows: Array<{
        trip_id: string;
        day_id: string | null;
        uploader_name: string;
        image_url: string;
        lat: number;
        lng: number;
        taken_at: string | null | undefined;
        caption: string;
        exif_found: boolean;
      }> = [];
      const failures: string[] = [];

      await mapWithConcurrency(inputs, UPLOAD_CONCURRENCY, async (input) => {
        const extension = input.file.name.split(".").pop() || "jpg";
        const path = `${data.trip!.slug}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, input.file, { cacheControl: "3600", upsert: false });
        if (uploadError) {
          failures.push(`${input.file.name}: ${uploadError.message}`);
          return;
        }
        const { data: publicData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
        rows.push({
          trip_id: data.trip!.id,
          day_id: input.dayId,
          uploader_name: input.uploaderName || "Friend",
          image_url: publicData.publicUrl,
          lat: input.coordinate.lat,
          lng: input.coordinate.lng,
          taken_at: input.exif?.takenAt,
          caption: input.caption,
          exif_found: input.exif?.exifFound ?? false,
        });
      });

      if (rows.length > 0) {
        const { error: insertError } = await supabase.from("photos").insert(rows);
        if (insertError) setError(insertError.message);
        else await loadData();
      }
      if (failures.length > 0) setError(`${failures.length} photo${failures.length === 1 ? "" : "s"} failed to upload. ${failures.slice(0, 2).join(" ")}`);
    }
    setSaving(false);
    closePanel();
  }

  async function saveRoute(input: { name: string; dayId: string | null; mode: RouteMode }) {
    if (routeDraftPoints.length < 2 || !data.trip) return;
    if (supabase && !isAdmin) {
      setError("Only trip admins can save routes.");
      return;
    }

    setSaving(true);
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
        setSaving(false);
        return;
      }
      const { error: insertError } = await supabase.from("route_segments").insert(row);
      if (insertError) setError(insertError.message);
      else await loadData();
    } else {
      setData((current) => ({
        ...current,
        routeSegments: [...current.routeSegments, { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }],
      }));
    }

    setSaving(false);
    closePanel();
  }

  async function updateTrip(input: { title: string; description: string | null; start_date: string | null; end_date: string | null }) {
    if (!data.trip) return;
    setAdminDataSaving(true);
    setAdminDataMessage(null);
    if (supabase) {
      const { error: updateError } = await supabase.from("trips").update(input).eq("id", data.trip.id);
      if (updateError) setAdminDataMessage(updateError.message);
      else {
        setAdminDataMessage("Trip updated.");
        await loadData();
      }
    } else {
      setData((current) => ({ ...current, trip: current.trip ? { ...current.trip, ...input } : current.trip }));
      setAdminDataMessage("Trip updated.");
    }
    setAdminDataSaving(false);
  }

  async function updateDay(dayId: string, input: { day_number: number; date: string | null; title: string | null; summary: string | null }) {
    if (!data.trip) return;
    setAdminDataSaving(true);
    setAdminDataMessage(null);
    if (supabase) {
      const { error: updateError } = await supabase.from("days").update(input).eq("id", dayId).eq("trip_id", data.trip.id);
      if (updateError) setAdminDataMessage(updateError.message);
      else {
        setAdminDataMessage("Day updated.");
        await loadData();
      }
    } else {
      setData((current) => ({ ...current, days: current.days.map((day) => day.id === dayId ? { ...day, ...input } : day).sort((a, b) => a.day_number - b.day_number) }));
      setAdminDataMessage("Day updated.");
    }
    setAdminDataSaving(false);
  }

  async function createDay(input: { day_number: number; date: string | null; title: string | null; summary: string | null }) {
    if (!data.trip) return;
    setAdminDataSaving(true);
    setAdminDataMessage(null);
    const row = { ...input, trip_id: data.trip.id };
    if (supabase) {
      const { error: insertError } = await supabase.from("days").insert(row);
      if (insertError) setAdminDataMessage(insertError.message);
      else {
        setAdminDataMessage("Day added.");
        await loadData();
      }
    } else {
      setData((current) => ({
        ...current,
        days: [...current.days, { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }].sort((a, b) => a.day_number - b.day_number),
      }));
      setAdminDataMessage("Day added.");
    }
    setAdminDataSaving(false);
  }

  async function updateRoute(routeId: string, input: { day_id: string | null; name: string | null; mode: RouteMode; source: string | null }) {
    if (!data.trip) return;
    setAdminDataSaving(true);
    setAdminDataMessage(null);
    if (supabase) {
      const { error: updateError } = await supabase.from("route_segments").update(input).eq("id", routeId).eq("trip_id", data.trip.id);
      if (updateError) setAdminDataMessage(updateError.message);
      else {
        setAdminDataMessage("Route updated.");
        await loadData();
      }
    } else {
      setData((current) => ({ ...current, routeSegments: current.routeSegments.map((route) => route.id === routeId ? { ...route, ...input } : route) }));
      setAdminDataMessage("Route updated.");
    }
    setAdminDataSaving(false);
  }

  async function updateNote(noteId: string, input: { day_id: string | null; author_name: string | null; body: string }) {
    if (!data.trip) return;
    setAdminDataSaving(true);
    setAdminDataMessage(null);
    if (supabase) {
      const { error: updateError } = await supabase.from("notes").update(input).eq("id", noteId).eq("trip_id", data.trip.id);
      if (updateError) setAdminDataMessage(updateError.message);
      else {
        setAdminDataMessage("Note updated.");
        await loadData();
      }
    } else {
      setData((current) => ({ ...current, notes: current.notes.map((note) => note.id === noteId ? { ...note, ...input } : note) }));
      setAdminDataMessage("Note updated.");
    }
    setAdminDataSaving(false);
  }

  async function updatePlace(placeId: string, input: { day_id: string | null; name: string; place_type: string | null; description: string | null; lat: number; lng: number }) {
    if (!data.trip) return;
    setAdminDataSaving(true);
    setAdminDataMessage(null);
    if (supabase) {
      const { error: updateError } = await supabase.from("places").update(input).eq("id", placeId).eq("trip_id", data.trip.id);
      if (updateError) setAdminDataMessage(updateError.message);
      else {
        setAdminDataMessage("Place updated.");
        await loadData();
      }
    } else {
      setData((current) => ({ ...current, places: current.places.map((place) => place.id === placeId ? { ...place, ...input } : place) }));
      setAdminDataMessage("Place updated.");
    }
    setAdminDataSaving(false);
  }

  async function updatePhoto(photoId: string, input: { day_id: string | null; uploader_name: string | null; caption: string | null }) {
    if (!data.trip) return;
    setAdminDataSaving(true);
    setAdminDataMessage(null);
    if (supabase) {
      const { error: updateError } = await supabase.from("photos").update(input).eq("id", photoId).eq("trip_id", data.trip.id);
      if (updateError) setAdminDataMessage(updateError.message);
      else {
        setAdminDataMessage("Photo updated.");
        await loadData();
      }
    } else {
      setData((current) => ({ ...current, photos: current.photos.map((photo) => photo.id === photoId ? { ...photo, ...input } : photo) }));
      setAdminDataMessage("Photo updated.");
    }
    setAdminDataSaving(false);
  }

  async function deleteDataItem(table: "days" | "route_segments" | "notes" | "places" | "photos", id: string) {
    if (!data.trip) return;
    setAdminDataSaving(true);
    setAdminDataMessage(null);
    if (supabase) {
      const { error: deleteError } = await supabase.from(table).delete().eq("id", id).eq("trip_id", data.trip.id);
      if (deleteError) setAdminDataMessage(deleteError.message);
      else {
        setAdminDataMessage("Item deleted.");
        await loadData();
      }
    } else {
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
      setAdminDataMessage("Item deleted.");
    }
    setAdminDataSaving(false);
  }

  return (
    <main className="relative h-dvh overflow-hidden bg-[#e7efe8] text-stone-950">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,253,246,0.92),rgba(211,229,222,0.5)_44%,rgba(234,198,132,0.26))]" />
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 px-3 py-3 md:px-6">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] px-4 py-2 text-sm font-black shadow-lg backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-[#d0872f]" /> Lofoten Logbook
        </div>
        <div className="flex items-center gap-2">
          <div className="pointer-events-auto hidden rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] px-4 py-2 text-xs font-semibold text-stone-700 shadow-lg backdrop-blur sm:block">{supabase ? (user ? `Signed in ${user.email ?? ""}` : "Supabase sign-in") : "Local demo mode"}</div>
          {supabase && user ? <button onClick={signOut} className="pointer-events-auto rounded-full border border-stone-200/80 bg-[rgba(255,253,246,0.9)] px-3 py-2 text-xs font-bold text-stone-700 shadow-lg backdrop-blur transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.97]">Sign out</button> : null}
        </div>
      </div>
      <div className="relative z-10 grid h-full gap-4 p-0 md:grid-cols-[24rem_minmax(0,1fr)] md:p-4 md:pt-[4.5rem]">
        <div className="z-10 hidden min-h-0 md:block"><DaySidebar days={data.days} selectedDayId={selectedDayId} onSelectDay={setSelectedDayId} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} onStartPhotoUpload={() => startPanel("photo")} onStartAddNote={() => startPanel("note")} onStartRouteDraw={isAdmin ? () => startPanel("route") : undefined} adminData={adminData} memberAdmin={memberAdmin} /></div>
        <MapView clickMode={clickMode} pendingCoordinate={pendingCoordinate} onMapReady={setMap} onCoordinatePick={handleCoordinatePick}>
          <TripLayers map={map} routes={filtered.routes} photos={filtered.photos} notes={filtered.notes} places={filtered.places} visibility={layerVisibility} />
          <RouteDraftLayer map={map} points={routeDraftPoints} />
          <MapLegend visibility={layerVisibility} />
        </MapView>
      </div>
      {!panel ? <MobileSheet days={data.days} selectedDayId={selectedDayId} onSelectDay={setSelectedDayId} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} onStartPhotoUpload={() => startPanel("photo")} onStartAddNote={() => startPanel("note")} onStartRouteDraw={isAdmin ? () => startPanel("route") : undefined} counts={{ photos: filtered.photos.length, notes: filtered.notes.length, places: filtered.places.length }} adminData={adminData} memberAdmin={memberAdmin} /> : null}
      {loading ? <StatusPill><Loader2 className="h-4 w-4 animate-spin text-teal-700" /> Loading trip data…</StatusPill> : null}
      {error ? <StatusPill tone="error" onDismiss={() => setError(null)}><AlertCircle className="h-4 w-4 shrink-0 text-rose-600" /> {error}</StatusPill> : null}
      {supabase && !authLoading && !user ? <AuthPanel message={authMessage} isSubmitting={authSubmitting} onSignIn={signIn} onSignInWithGoogle={signInWithGoogle} /> : null}
      {panel === "note" ? <AddNotePanel days={data.days} selectedCoordinate={pendingCoordinate} defaultDayId={selectedDayId} isSaving={saving} onCancel={closePanel} onSave={saveNote} /> : null}
      {panel === "photo" ? <UploadPhotoPanel days={data.days} routes={data.routeSegments} defaultDayId={selectedDayId} pendingCoordinate={pendingCoordinate} isSaving={saving} onCancel={closePanel} onCoordinatePreview={setPendingCoordinate} onSave={savePhotos} /> : null}
      {panel === "route" ? <ManualRoutePanel days={data.days} defaultDayId={selectedDayId} points={routeDraftPoints} distanceMeters={routeDraftDistance} isSaving={saving} onCancel={closePanel} onUndoPoint={() => setRouteDraftPoints((current) => current.slice(0, -1))} onClear={() => setRouteDraftPoints([])} onSave={saveRoute} /> : null}
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
      {onDismiss ? <button onClick={onDismiss} className="-mr-1 ml-1 rounded-full p-1 text-current/70 transition hover:bg-rose-900/10" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button> : null}
    </div>
  );
}

function AuthPanel({ message, isSubmitting, onSignIn, onSignInWithGoogle }: { message: string | null; isSubmitting: boolean; onSignIn: (email: string) => Promise<void>; onSignInWithGoogle: () => Promise<void> }) {
  async function submit(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    if (email) await onSignIn(email);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/35 p-4 backdrop-blur-sm">
      <form action={submit} className="w-full max-w-md rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.97)] p-5 text-stone-950 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-teal-50 p-3 text-teal-800"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <h2 className="font-serif text-2xl font-semibold">Sign in to Lofoten</h2>
            <p className="text-sm leading-6 text-stone-600">Supabase mode is private to trip members.</p>
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
        {message ? <div className="mb-3 rounded-lg border border-teal-700/20 bg-teal-50 p-3 text-sm text-teal-950">{message}</div> : null}
        <button disabled={isSubmitting} className="w-full rounded-lg bg-[#e7a13d] px-4 py-3 font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
          {isSubmitting ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <LogIn className="mr-2 inline h-4 w-4" />} Send sign-in link
        </button>
      </form>
    </div>
  );
}
