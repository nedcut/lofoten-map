"use client";

import dynamic from "next/dynamic";
import mapboxgl from "mapbox-gl";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { AddNotePanel } from "@/components/AddNotePanel";
import { DaySidebar } from "@/components/DaySidebar";
import { TripLayers } from "@/components/TripLayers";
import { UploadPhotoPanel } from "@/components/UploadPhotoPanel";
import { PHOTO_BUCKET, getSupabaseBrowserClient } from "@/lib/supabase";
import type { ExtractedExif } from "@/lib/exif";
import type { Day, LngLat, MapClickMode, Note, Place, RouteSegment, Trip, TripData } from "@/types/trip";

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

export default function Home() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [data, setData] = useState<TripData>({ trip: demoTrip, days: demoDays, routeSegments: demoRoutes, photos: [], notes: demoNotes, places: demoPlaces });
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [layerVisibility, setLayerVisibility] = useState({ photos: true, notes: true, routes: true });
  const [clickMode, setClickMode] = useState<MapClickMode>("idle");
  const [pendingCoordinate, setPendingCoordinate] = useState<LngLat | null>(null);
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [panel, setPanel] = useState<"photo" | "note" | null>(null);
  const [exif, setExif] = useState<ExtractedExif | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);

  const tripSlug = process.env.NEXT_PUBLIC_TRIP_SLUG ?? "lofoten-2026";

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data: trip, error: tripError } = await supabase.from("trips").select("*").eq("slug", tripSlug).maybeSingle();
    if (tripError || !trip) {
      setError("Supabase is configured, but the trip was not found. Run supabase/schema.sql and supabase/seed.sql.");
      setLoading(false);
      return;
    }
    const [days, routes, photos, notes, places] = await Promise.all([
      supabase.from("days").select("*").eq("trip_id", trip.id).order("day_number"),
      supabase.from("route_segments").select("*").eq("trip_id", trip.id).order("created_at"),
      supabase.from("photos").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
      supabase.from("notes").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
      supabase.from("places").select("*").eq("trip_id", trip.id).order("created_at", { ascending: false }),
    ]);
    const failure = [days.error, routes.error, photos.error, notes.error, places.error].find(Boolean);
    if (failure) setError(failure.message);
    else setData({ trip, days: days.data ?? [], routeSegments: (routes.data ?? []) as RouteSegment[], photos: photos.data ?? [], notes: notes.data ?? [], places: places.data ?? [] });
    setLoading(false);
  }, [supabase, tripSlug]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!supabase || !data.trip) return;
    const channel = supabase
      .channel("lofoten-logbook-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "photos", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "route_segments", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "places", filter: `trip_id=eq.${data.trip.id}` }, loadData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [data.trip, loadData, supabase]);

  const filtered = useMemo(() => {
    const matches = (dayId: string | null) => !selectedDayId || dayId === selectedDayId;
    return {
      routes: data.routeSegments.filter((item) => matches(item.day_id)),
      photos: data.photos.filter((item) => matches(item.day_id)),
      notes: data.notes.filter((item) => matches(item.day_id)),
      places: data.places.filter((item) => matches(item.day_id)),
    };
  }, [data, selectedDayId]);

  function startPanel(next: "photo" | "note") {
    setPanel(next);
    setPendingCoordinate(null);
    setClickMode(next === "photo" ? "place-photo" : "add-note");
  }

  function closePanel() {
    setPanel(null);
    setClickMode("idle");
    setPendingCoordinate(null);
    setExif(null);
    setPhotoFile(null);
  }

  async function saveNote(input: { body: string; authorName: string; dayId: string | null }) {
    if (!pendingCoordinate || !input.body || !data.trip) return;
    setSaving(true);
    const row = { trip_id: data.trip.id, day_id: input.dayId, author_name: input.authorName || "Friend", lat: pendingCoordinate.lat, lng: pendingCoordinate.lng, body: input.body, note_type: "note" };
    if (supabase) {
      const { error: insertError } = await supabase.from("notes").insert(row);
      if (insertError) setError(insertError.message);
      else await loadData();
    } else {
      setData((current) => ({ ...current, notes: [{ ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }, ...current.notes] }));
    }
    setSaving(false);
    closePanel();
  }

  async function savePhoto(input: { file: File; caption: string; uploaderName: string; dayId: string | null }) {
    if (!pendingCoordinate || !data.trip) return;
    setSaving(true);
    if (!supabase) {
      const imageUrl = URL.createObjectURL(input.file);
      setData((current) => ({ ...current, photos: [{ id: crypto.randomUUID(), trip_id: data.trip!.id, day_id: input.dayId, uploader_name: input.uploaderName || "Friend", image_url: imageUrl, thumbnail_url: null, lat: pendingCoordinate.lat, lng: pendingCoordinate.lng, taken_at: exif?.takenAt ?? null, caption: input.caption, exif_found: exif?.exifFound ?? false, created_at: new Date().toISOString() }, ...current.photos] }));
    } else {
      const extension = input.file.name.split(".").pop() || "jpg";
      const path = `${data.trip.slug}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, input.file, { cacheControl: "3600", upsert: false });
      if (uploadError) setError(uploadError.message);
      else {
        const { data: publicData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
        const { error: insertError } = await supabase.from("photos").insert({ trip_id: data.trip.id, day_id: input.dayId, uploader_name: input.uploaderName || "Friend", image_url: publicData.publicUrl, lat: pendingCoordinate.lat, lng: pendingCoordinate.lng, taken_at: exif?.takenAt, caption: input.caption, exif_found: exif?.exifFound ?? false });
        if (insertError) setError(insertError.message);
        else await loadData();
      }
    }
    setSaving(false);
    closePanel();
  }

  return (
    <main className="h-dvh overflow-hidden bg-slate-950 text-white">
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="rounded-full border border-white/15 bg-slate-950/70 px-4 py-2 text-sm font-black shadow-xl backdrop-blur">Lofoten Logbook</div>
        <div className="rounded-full border border-white/15 bg-slate-950/70 px-4 py-2 text-xs text-slate-200 shadow-xl backdrop-blur">{supabase ? "Live Supabase mode" : "Local demo mode"}</div>
      </div>
      <div className="grid h-full gap-4 p-0 md:grid-cols-[24rem_minmax(0,1fr)] md:p-4">
        <div className="z-10 hidden md:block"><DaySidebar days={data.days} selectedDayId={selectedDayId} onSelectDay={setSelectedDayId} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} onStartPhotoUpload={() => startPanel("photo")} onStartAddNote={() => startPanel("note")} /></div>
        <MapView clickMode={clickMode} pendingCoordinate={pendingCoordinate} onMapReady={setMap} onCoordinatePick={setPendingCoordinate}>
          <TripLayers map={map} routes={filtered.routes} photos={filtered.photos} notes={filtered.notes} places={filtered.places} visibility={layerVisibility} />
        </MapView>
      </div>
      <div className="fixed inset-x-3 bottom-3 z-20 md:hidden">
        {!panel ? <DaySidebar days={data.days} selectedDayId={selectedDayId} onSelectDay={setSelectedDayId} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} onStartPhotoUpload={() => startPanel("photo")} onStartAddNote={() => startPanel("note")} /> : null}
      </div>
      {loading ? <StatusPill><Loader2 className="h-4 w-4 animate-spin" /> Loading trip data...</StatusPill> : null}
      {error ? <StatusPill><AlertCircle className="h-4 w-4 text-amber-200" /> {error}</StatusPill> : null}
      {panel === "note" ? <AddNotePanel days={data.days} selectedCoordinate={pendingCoordinate} defaultDayId={selectedDayId} isSaving={saving} onCancel={closePanel} onSave={saveNote} /> : null}
      {panel === "photo" ? <UploadPhotoPanel days={data.days} defaultDayId={selectedDayId} pendingCoordinate={pendingCoordinate} exif={exif} fileName={photoFile?.name ?? null} isSaving={saving} onCancel={closePanel} onExifRead={(file, extracted) => { setPhotoFile(file); setExif(extracted); if (extracted.lat !== null && extracted.lng !== null) setPendingCoordinate({ lat: extracted.lat, lng: extracted.lng }); }} onSave={savePhoto} /> : null}
    </main>
  );
}

function StatusPill({ children }: { children: ReactNode }) {
  return <div className="fixed left-1/2 top-16 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-slate-950/85 px-4 py-2 text-sm text-white shadow-xl backdrop-blur">{children}</div>;
}
