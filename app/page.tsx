"use client";

import dynamic from "next/dynamic";
// Types only — a value import of mapbox-gl here would pull the whole library
// into the initial bundle and defeat MapView's dynamic() split.
import type { Map as MapboxMap } from "mapbox-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Play, Share2, Sparkles, UserRound } from "lucide-react";
import { collectItemCoordinates, coordinateBounds, routeDistanceMeters } from "@/lib/geo";
import { DayDot, DaySidebar } from "@/components/DaySidebar";
import { MOBILE_SHEET_HEIGHT_VAR, MobileSheet } from "@/components/MobileSheet";
import { StatusPill } from "@/components/StatusPill";
import { HeaderPill, PillButton } from "@/components/ui/HeaderPill";
import type { MapItemKind } from "@/components/TripLayers";
import { deriveTripAccess } from "@/lib/access";
import { dayColorFor, dayColorMap } from "@/lib/day-colors";
import { demoTripData, emptyTripData } from "@/lib/demo-trip";
import { isPreviewReadOnly } from "@/lib/preview-read-only";
import { useTripAuth } from "@/lib/hooks/useTripAuth";
import { useTripData } from "@/lib/hooks/useTripData";
import { useProfile } from "@/lib/hooks/useProfile";
import { useMembership } from "@/lib/hooks/useMembership";
import { useTripMutations } from "@/lib/hooks/useTripMutations";
import { useTripCreation } from "@/lib/hooks/useTripCreation";
import { useJourneyState } from "@/lib/hooks/useJourneyState";
import { useTripUrlState } from "@/lib/hooks/useTripUrlState";
import { buildJourneyItems } from "@/lib/journey";
import type { PhotoOutlier } from "@/lib/photo-outliers";
import { getBackendBrowserClient } from "@/lib/backend";
import { shareJourneyLink, type ShareResult } from "@/lib/share";
import { deriveDayStats, deriveOutlierOverlay, filterItemsByDay, resolveEditTarget } from "@/lib/trip-view-model";
import { cn, formatDateOnly } from "@/lib/utils";
import type { LngLat, MapClickMode } from "@/types/trip";

const AuthPanel = dynamic(() => import("@/components/AuthPanel").then((mod) => mod.AuthPanel));
const EditItemPanel = dynamic(() => import("@/components/EditItemPanel").then((mod) => mod.EditItemPanel));

const MapView = dynamic(() => import("@/components/MapView").then((mod) => mod.MapView), { ssr: false });
// These also value-import mapbox-gl (markers, popups, the mini map), so they
// must stay out of the static import graph for the same reason as MapView.
const TripLayers = dynamic(() => import("@/components/TripLayers").then((mod) => mod.TripLayers), { ssr: false });
const RouteDraftLayer = dynamic(() => import("@/components/RouteDraftLayer").then((mod) => mod.RouteDraftLayer), { ssr: false });
const JourneyPlayback = dynamic(() => import("@/components/JourneyPlayback").then((mod) => mod.JourneyPlayback), { ssr: false });
const AddNotePanel = dynamic(() => import("@/components/AddNotePanel").then((mod) => mod.AddNotePanel));
const ManualRoutePanel = dynamic(() => import("@/components/ManualRoutePanel").then((mod) => mod.ManualRoutePanel));
const ProfilePanel = dynamic(() => import("@/components/ProfilePanel").then((mod) => mod.ProfilePanel));
const UploadPhotoPanel = dynamic(() => import("@/components/UploadPhotoPanel").then((mod) => mod.UploadPhotoPanel));

// Padding for fitBounds so framed content stays clear of the chrome. On phones
// the bottom sheet's measured collapsed height (published by MobileSheet as a
// CSS variable) replaces a guessed constant.
function mapFramingPadding() {
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  if (!isMobile) return { top: 80, right: 80, bottom: 80, left: 80 };
  const sheet = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(MOBILE_SHEET_HEIGHT_VAR));
  return { top: 96, right: 48, bottom: (Number.isFinite(sheet) && sheet > 0 ? sheet : 160) + 48, left: 48 };
}

export default function Home() {
  const backend = useMemo(() => getBackendBrowserClient(), []);
  const tripSlug = process.env.NEXT_PUBLIC_TRIP_SLUG ?? "lofoten-2026";
  const {
    user,
    authLoading,
    authMessage,
    authMessageTone,
    authSubmitting,
    authPanelOpen,
    setAuthPanelOpen,
    pendingOtpEmail,
    signIn,
    verifyCode,
    cancelCodeEntry,
    signInWithGoogle,
    signOut,
  } = useTripAuth(backend);
  const {
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
  } = useTripData({
    backend,
    user,
    authLoading,
    tripSlug,
    initialData: backend ? emptyTripData : demoTripData,
  });
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [layerVisibility, setLayerVisibility] = useState({ photos: true, notes: true, routes: true });
  const [clickMode, setClickMode] = useState<MapClickMode>("idle");
  const [pendingCoordinate, setPendingCoordinate] = useState<LngLat | null>(null);
  const [routeDraftPoints, setRouteDraftPoints] = useState<LngLat[]>([]);
  const [map, setMap] = useState<MapboxMap | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [panel, setPanel] = useState<"photo" | "note" | "route" | null>(null);
  const [lastFocusedPhotoId, setLastFocusedPhotoId] = useState<string | null>(null);
  const [outlierPreview, setOutlierPreview] = useState<PhotoOutlier | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareResult | null>(null);

  const allJourneyItems = useMemo(() => buildJourneyItems(data), [data]);
  const {
    activeJourneyId,
    setActiveJourneyId,
    activeJourneyIndex,
    journeyOpen,
    journeyItems,
    journeyFilter,
    setJourneyFilter,
    journeyUploaderFilter,
    setJourneyUploaderFilter,
    journeyIntro,
    setJourneyIntro,
    openJourneyAt,
    closeJourney,
    restoreJourneyFromUrl,
    selectJourneyIndex,
    selectJourneyItem,
    nextJourneyItem,
    prevJourneyItem,
    openJourneyFromMap,
    playDayJourney,
  } = useJourneyState({ allJourneyItems });
  const { selectedDayId, selectDay: selectUrlDay, editTargetRef, openEditItem, closeEditItem } = useTripUrlState({
    data,
    allJourneyItems,
    loading,
    onJourneyFromUrl: restoreJourneyFromUrl,
  });
  // Keep unrelated map layers stable when a poll changes just one collection.
  const filteredRoutes = useMemo(() => filterItemsByDay(data.routeSegments, selectedDayId), [data.routeSegments, selectedDayId]);
  const filteredPhotos = useMemo(() => filterItemsByDay(data.photos, selectedDayId), [data.photos, selectedDayId]);
  const filteredNotes = useMemo(() => filterItemsByDay(data.notes, selectedDayId), [data.notes, selectedDayId]);
  const filteredPlaces = useMemo(() => filterItemsByDay(data.places, selectedDayId), [data.places, selectedDayId]);
  const filtered = useMemo(() => ({ routes: filteredRoutes, photos: filteredPhotos, notes: filteredNotes, places: filteredPlaces }), [filteredRoutes, filteredPhotos, filteredNotes, filteredPlaces]);
  const tripTitle = data.trip?.title ?? "Trip Logbook";
  // Per-day totals for the day cards, computed over the full dataset (not the
  // current filter) so each card describes its whole day.
  const dayStats = useMemo(() => deriveDayStats(data), [data]);
  // One accent colour per day, shared by the day cards, route lines, marker
  // badges, and the on-map day chip.
  const dayColors = useMemo(() => dayColorMap(data.days), [data.days]);
  const selectedDay = useMemo(() => data.days.find((day) => day.id === selectedDayId) ?? null, [data.days, selectedDayId]);
  // These render a modal overlay on top of the header/sidebar/map, so those
  // stay `inert` (unfocusable, hidden from assistive tech) underneath rather
  // than merely obscured. The note, media, route, and edit panels are
  // deliberately excluded: they sit beside the map and need its clicks for
  // placement and drawing, so they trap keyboard focus but leave the map live.
  const overlayOpen = Boolean(authPanelOpen || profilePanelOpen || journeyOpen);

  const access = useMemo(
    () => deriveTripAccess({
      backendEnabled: Boolean(backend),
      userId: user?.id ?? null,
      members: data.members,
      adminRequests: data.adminRequests,
      readOnly: isPreviewReadOnly(),
    }),
    [backend, data.adminRequests, data.members, user?.id],
  );
  const { currentMember, currentUserId, canContribute, isAdmin } = access;
  const previewReadOnly = Boolean(backend) && isPreviewReadOnly();
  // Owner/admin map and journey edits key off this id; drop it in read-only
  // preview so a signed-in member cannot drag, caption, or delete live data.
  const mutationUserId = canContribute ? currentUserId : null;

  const selectDay = useCallback((dayId: string | null) => {
    // Switching days is a deliberate change of context, so any lingering
    // photo-popup focus stops steering where Journey Mode starts.
    setLastFocusedPhotoId(null);
    selectUrlDay(dayId);
  }, [selectUrlDay]);

  // Domain hooks own the demo-mode vs. Neon write paths and their status
  // channels, so this component only holds view state and wiring.
  const { isSaving: profileSaving, saveProfile } = useProfile({
    backend,
    user,
    currentMember,
    trip: data.trip,
    loadData,
    onError: setError,
    onNotice: setNotice,
    onSaved: () => setProfilePanelOpen(false),
  });
  const { status: memberStatus, grantMember, requestAdmin, setMemberRole, resolveAdminRequest } = useMembership({
    backend,
    trip: data.trip,
    loadData,
  });
  const {
    status: adminStatus,
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
  } = useTripMutations({
    backend,
    user,
    isAdmin,
    data,
    setData,
    loadData,
    selectedDayId,
    selectDay,
    setGlobalError: setError,
  });

  const closePanel = useCallback(() => {
    setPanel(null);
    setClickMode("idle");
    setPendingCoordinate(null);
    setRouteDraftPoints([]);
  }, []);

  const { saving, saveNote, savePhotos, saveRoute } = useTripCreation({
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
    onSaved: closePanel,
    setError,
    setNotice,
  });

  // Resolve the popup-selected item live from data, so the editor reflects updates
  // and closes automatically if the item is deleted (here or by another member).
  const editTarget = useMemo(() => resolveEditTarget(data, editTargetRef), [editTargetRef, data]);
  const memberAdmin = access.showMemberAdminControls
    ? {
      members: data.members,
      requests: adminRequestsAvailable ? access.pendingAdminRequests : [],
      currentUserId,
      message: memberStatus.message,
      messageTone: memberStatus.tone,
      isSaving: memberStatus.isSaving,
      onGrantMember: grantMember,
      onSetMemberRole: setMemberRole,
      onResolveRequest: resolveAdminRequest,
    }
    : null;
  // Shown to signed-in members who are not admins: a way to ask for an upgrade.
  const adminRequest = adminRequestsAvailable && access.showAdminRequestControls
    ? { status: access.currentUserAdminRequest?.status ?? null, isSaving: memberStatus.isSaving, message: memberStatus.message, messageTone: memberStatus.tone, onRequestAdmin: requestAdmin }
    : null;
  const routeDraftDistance = useMemo(() => routeDistanceMeters(routeDraftPoints), [routeDraftPoints]);
  const mapActionsEnabled = !mapUnavailable;
  const adminData = isAdmin
    ? {
      trip: data.trip,
      days: data.days,
      routes: data.routeSegments,
      notes: data.notes,
      places: data.places,
      photos: data.photos,
      message: adminStatus.message,
      messageTone: adminStatus.tone,
      isSaving: adminStatus.isSaving,
      onUpdateTrip: updateTrip,
      onCreateDay: createDay,
      onUpdateDay: updateDay,
      onUpdateRoute: updateRoute,
      onUpdateNote: updateNote,
      onUpdatePlace: updatePlace,
      onUpdatePhoto: updatePhoto,
      onDeleteItem: deleteDataItem,
      onImportGpx: importGpx,
      onPreviewOutlier: previewOutlier,
    }
    : null;
  // Map-friendly shape of the previewed outlier (drops photos with no coords).
  const outlierOverlay = useMemo(() => deriveOutlierOverlay(outlierPreview), [outlierPreview]);
  // Notes and places only have mouse-driven map layers; this gives keyboard and
  // screen-reader users a way to reach the same edit path startEditFromMap
  // wires up for a map-popup click. Same owner-or-admin rule as the popup
  // controls: notes the viewer owns, places only for admins.
  const notesPlacesEntry = useMemo(() => ({
    // A null id would otherwise match every ownerless note.
    notes: isAdmin ? filtered.notes : mutationUserId ? filtered.notes.filter((note) => note.user_id === mutationUserId) : [],
    places: isAdmin ? filtered.places : [],
    onOpen: (kind: "note" | "place", id: string) => startEditFromMap(kind, id),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEditFromMap is a plain function (not memoized) redefined every render; omitted to avoid invalidating this memo on every render too.
  }), [filtered.notes, filtered.places, isAdmin, mutationUserId]);

  // A photo only steers the journey start while its popup is open. Guarded so
  // closing a stale popup can't wipe focus from a newer one opened after it.
  const handlePhotoBlur = useCallback((photoId: string) => {
    setLastFocusedPhotoId((current) => (current === photoId ? null : current));
  }, []);

  // The header Journey button picks its starting item by context: the photo the
  // user last opened on the map wins, then the first item of the selected day,
  // then the start of the trip. The fallbacks matter because the last-clicked
  // photo may have been deleted, and the selected day may have no journal items.
  const startJourney = useCallback(() => {
    if (journeyItems.length === 0) return;
    const lastFocused = lastFocusedPhotoId
      ? journeyItems.find((item) => item.id === `photo:${lastFocusedPhotoId}`)
      : undefined;
    const dayStart = selectedDayId
      ? journeyItems.find((item) => item.dayId === selectedDayId)
      : undefined;
    setJourneyIntro(!lastFocusedPhotoId && !selectedDayId);
    openJourneyAt((lastFocused ?? dayStart ?? journeyItems[0]).id);
  }, [journeyItems, lastFocusedPhotoId, openJourneyAt, selectedDayId, setJourneyIntro]);

  // Bundle for the sidebar/mobile Journey hero + per-day play buttons. With a
  // day selected the hero describes (and previews) that day, matching what
  // startJourney will actually do; otherwise it describes the whole trip.
  const journeyEntry = useMemo(() => {
    const dayMoments = selectedDayId ? allJourneyItems.filter((item) => item.dayId === selectedDayId).length : allJourneyItems.length;
    return {
      photos: selectedDayId ? data.photos.filter((photo) => photo.day_id === selectedDayId) : data.photos,
      momentCount: dayMoments,
      dayCount: data.days.length,
      day: selectedDay,
      onPlay: startJourney,
      onPlayDay: playDayJourney,
      disabled: allJourneyItems.length === 0,
    };
  }, [data.photos, data.days.length, allJourneyItems, selectedDay, selectedDayId, startJourney, playDayJourney]);

  // Share whatever is on screen: the URL already encodes the selected day, so
  // a copied link lands the recipient on the same view.
  const shareTimerRef = useRef<number | null>(null);
  const shareView = useCallback(async () => {
    const text = selectedDay ? `Day ${selectedDay.day_number}${selectedDay.title ? `: ${selectedDay.title}` : ""}` : tripTitle;
    const result = await shareJourneyLink(navigator, { title: tripTitle, text, url: window.location.href });
    if (result === "cancelled") return;
    setShareStatus(result);
    if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
    shareTimerRef.current = window.setTimeout(() => setShareStatus(null), 2500);
  }, [selectedDay, tripTitle]);
  useEffect(() => () => { if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current); }, []);

  // Step the map-view day filter forward/backward through ["All days", day 1,
  // day 2, ...], clamped at both ends so repeated presses don't wrap around.
  const stepDay = useCallback((direction: 1 | -1) => {
    const sequence: Array<string | null> = [null, ...data.days.map((day) => day.id)];
    const currentIndex = Math.max(0, sequence.indexOf(selectedDayId));
    const nextIndex = Math.min(sequence.length - 1, Math.max(0, currentIndex + direction));
    if (nextIndex !== currentIndex) selectDay(sequence[nextIndex]);
  }, [data.days, selectDay, selectedDayId]);

  // Arrow keys step the day filter while the map view has focus. Journey Mode
  // has its own ArrowLeft/Right handler, and open panels capture typing, so the
  // listener simply isn't attached in those states rather than checking inside.
  useEffect(() => {
    if (activeJourneyId || panel || editTargetRef || authPanelOpen || profilePanelOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      // Capture-phase + stopPropagation so the keystroke never reaches the
      // Mapbox canvas, which would otherwise also pan the map on arrow keys.
      event.preventDefault();
      event.stopPropagation();
      stepDay(event.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [activeJourneyId, authPanelOpen, editTargetRef, panel, profilePanelOpen, stepDay]);

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

  const handleMapReady = useCallback((nextMap: MapboxMap) => {
    setMapUnavailable(false);
    setMap(nextMap);
  }, []);

  const handleMapUnavailable = useCallback(() => {
    setMap(null);
    setMapUnavailable(true);
    setClickMode("idle");
    setPendingCoordinate(null);
    setRouteDraftPoints([]);
    // Media selection and draft recovery work without Mapbox; only workflows
    // that require map clicks must close when availability changes.
    setPanel((current) => current === "photo" ? current : null);
  }, []);

  // Keep the latest filtered items in a ref so the framing effect below can read
  // them without re-firing every time realtime data updates — we only want to
  // recenter when the selected day (or map readiness) actually changes.
  const filteredRef = useRef(filtered);
  // Updated in an effect (not during render) so the framing effect below, which
  // is declared after this one and so runs after it within the same commit,
  // always reads the latest filtered items.
  useEffect(() => {
    filteredRef.current = filtered;
  }, [filtered]);

  // Center the map on the active day (or all days) whenever the selection
  // changes: build a bounding box around that day's items and fit it with
  // padding. Mobile gets extra bottom padding so the bottom sheet doesn't cover
  // the framed content; a lone point falls back to an eased zoom since a
  // zero-area box can't be fit.
  useEffect(() => {
    if (!map) return;
    const coords = collectItemCoordinates(filteredRef.current);
    if (coords.length === 0) return;

    const padding = mapFramingPadding();

    const bounds = coordinateBounds(coords);
    if (!bounds) return;

    if (bounds.diagonalMeters < 1) {
      map.easeTo({ center: bounds.center, zoom: 13.5, padding, duration: 800 });
      return;
    }
    map.fitBounds([bounds.sw, bounds.ne], { padding, maxZoom: 14, duration: 800 });
  }, [map, selectedDayId]);

  function startPanel(next: "photo" | "note" | "route") {
    if (!mapActionsEnabled && next !== "photo") return;
    setPanel(next);
    setPendingCoordinate(null);
    if (next === "route") {
      setRouteDraftPoints([]);
      setClickMode("draw-route");
    } else {
      setRouteDraftPoints([]);
      setClickMode(next === "photo" && mapActionsEnabled ? "place-photo" : next === "note" ? "add-note" : "idle");
    }
  }

  // Opened from a map popup. RLS enforces who may write; the popup only shows the
  // buttons to owners/admins, and these handlers reuse the existing data mutations.
  function startEditFromMap(kind: MapItemKind, id: string) {
    closePanel();
    openEditItem(kind, id);
  }

  // "Edit details" inside Journey Mode: swap the viewer for the editor panel.
  // Marking the photo as last-focused means reopening Journey resumes there.
  function editPhotoFromJourney(photoId: string) {
    const photo = data.photos.find((item) => item.id === photoId);
    // The map only renders the selected day's markers; hop to the photo's day
    // so the marker (and its highlight ring) are actually on the map. Runs
    // before setLastFocusedPhotoId because selectDay clears the focus.
    if (photo && selectedDayId && photo.day_id !== selectedDayId) selectDay(photo.day_id ?? null);
    setLastFocusedPhotoId(photoId);
    setActiveJourneyId(null);
    startEditFromMap("photo", photoId);
    // The main map was hidden behind the journey overlay and may be framing a
    // different part of the trip entirely — bring the edited photo into view.
    // Delayed past the unhide-resize (60ms effect), and offset so the editor
    // panel (right on desktop, bottom sheet on mobile) doesn't cover it.
    if (!map || !photo || photo.lng === null || photo.lat === null) return;
    const target: [number, number] = [photo.lng, photo.lat];
    window.setTimeout(() => {
      const isMobile = window.innerWidth < 768;
      map.easeTo({
        center: target,
        zoom: Math.max(map.getZoom(), 13.5),
        offset: isMobile ? [0, -120] : [-160, 0],
        duration: 900,
      });
    }, 120);
  }

  // Hover/click on a Location-check row: show the flagged photo, its
  // time-neighbor group, and the suggested spot on the map. A click also
  // frames the map around all of it so an off-screen stray becomes visible.
  function previewOutlier(outlier: PhotoOutlier | null, options?: { focus?: boolean }) {
    setOutlierPreview(outlier);
    if (!options?.focus || !outlier || !map) return;
    const photo = outlier.photo;
    if (photo.lng === null || photo.lat === null) return;
    const coords: [number, number][] = [
      [photo.lng, photo.lat],
      [outlier.suggested.lng, outlier.suggested.lat],
      ...outlier.neighbors.map((neighbor): [number, number] => [neighbor.lng, neighbor.lat]),
    ];
    const bounds = coordinateBounds(coords);
    if (!bounds) return;
    map.fitBounds([bounds.sw, bounds.ne], { padding: mapFramingPadding(), maxZoom: 14, duration: 800 });
  }

  async function deleteFromMap(kind: MapItemKind, id: string) {
    const table = ({ photo: "photos", note: "notes", place: "places", route: "route_segments" } as const)[kind];
    if (!window.confirm("Delete this item? This can't be undone.")) return;
    await deleteDataItem(table, id);
  }

  return (
    <main className="relative h-dvh overflow-hidden bg-mist text-stone-950">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,253,246,0.92),rgba(211,229,222,0.5)_44%,rgba(234,198,132,0.26))]" />
      <div inert={overlayOpen} className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-6">
        <HeaderPill className="flex max-w-[min(18rem,calc(100vw-11rem))] items-center gap-2 text-sm font-black text-stone-950 sm:max-w-none">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-ember-500" /> <span className="truncate">{tripTitle}</span>
        </HeaderPill>
        <div className="flex items-center gap-2">
          {backend && user && !previewReadOnly ? <HeaderPill className="hidden sm:block">{currentMember ? `Signed in ${user.email ?? ""}` : "Signed in · view only"}</HeaderPill> : null}
          {previewReadOnly ? <HeaderPill className="hidden sm:block">Preview · view only</HeaderPill> : null}
          {!backend ? <HeaderPill className="hidden sm:block">Local demo mode</HeaderPill> : null}
          <PillButton onClick={startJourney} disabled={journeyItems.length === 0} aria-label="Relive the journey">
            <Play className="h-3.5 w-3.5 fill-current text-ember-500" /> <span className="hidden sm:inline">Relive</span>
          </PillButton>
          <PillButton onClick={shareView} aria-label={selectedDay ? `Share Day ${selectedDay.day_number}` : "Share this trip"} title="Copy a link to this view">
            <Share2 className="h-3.5 w-3.5 text-teal-700" /> <span className="hidden sm:inline">Share</span>
          </PillButton>
          {backend && user && currentMember && profilesAvailable && canContribute ? (
            <PillButton onClick={() => setProfilePanelOpen(true)} aria-label="Edit your profile" className="py-1 pl-1 pr-3">
              <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-stone-200">
                {currentMember.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={currentMember.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UserRound className="h-3.5 w-3.5 text-stone-500" />
                )}
              </span>
              <span className="hidden sm:inline">Profile</span>
            </PillButton>
          ) : null}
          {backend && user ? <PillButton onClick={signOut}>Sign out</PillButton> : null}
          {backend && !authLoading && !user && !previewReadOnly ? (
            // Viewing is open to everyone; the label says what signing in
            // is actually for instead of a separate "guest" status chip.
            // Previews hide it: signing in there can't unlock any edits.
            <PillButton onClick={() => setAuthPanelOpen(true)}>Sign in<span className="hidden sm:inline"> to add photos</span></PillButton>
          ) : null}
        </div>
      </div>
      <div inert={overlayOpen} className="relative z-10 grid h-full gap-4 p-0 md:grid-cols-[24rem_minmax(0,1fr)] md:p-4 md:pt-[4.5rem]">
        <div className="z-10 hidden min-h-0 md:block"><DaySidebar trip={data.trip} days={data.days} dayStats={dayStats} dayColors={dayColors} selectedDayId={selectedDayId} onSelectDay={selectDay} onStepDay={stepDay} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} showLayerControls={mapActionsEnabled} onStartPhotoUpload={canContribute ? () => startPanel("photo") : undefined} onStartAddNote={canContribute && mapActionsEnabled ? () => startPanel("note") : undefined} onStartRouteDraw={isAdmin && mapActionsEnabled ? () => startPanel("route") : undefined} journey={journeyEntry} notesPlaces={notesPlacesEntry} adminData={adminData} memberAdmin={memberAdmin} adminRequest={adminRequest} /></div>
        <div className={cn("h-full min-h-0", journeyOpen && "hidden")}>
          <MapView clickMode={clickMode} pendingCoordinate={pendingCoordinate} onMapReady={handleMapReady} onMapUnavailable={handleMapUnavailable} onCoordinatePick={handleCoordinatePick}>
            {!mapUnavailable ? <TripLayers map={map} routes={filtered.routes} photos={filtered.photos} notes={filtered.notes} places={filtered.places} days={data.days} dayColors={dayColors} visibility={layerVisibility} currentUserId={mutationUserId} isAdmin={isAdmin} onEditItem={startEditFromMap} onDeleteItem={deleteFromMap} onOpenJourney={openJourneyFromMap} onPhotoFocus={setLastFocusedPhotoId} onPhotoBlur={handlePhotoBlur} onMovePhoto={movePhoto} highlightedPhotoId={editTarget?.kind === "photo" ? editTarget.item.id : null} outlierPreview={outlierOverlay} /> : null}
            {!mapUnavailable ? <RouteDraftLayer map={map} points={routeDraftPoints} /> : null}
            {/* Which day the map is filtered to. Sits under the header on
                phones (the map runs full-bleed there) and in the map's own
                top-left corner on desktop. Hidden while a placement prompt
                occupies the same spot. */}
            {!mapUnavailable && selectedDay && clickMode === "idle" ? (
              <div className="pointer-events-none absolute left-3 top-16 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full border border-stone-200/80 bg-paper/92 py-1.5 pl-3 pr-4 text-xs font-bold text-stone-900 shadow-control backdrop-blur md:left-4 md:top-4">
                <DayDot color={dayColorFor(dayColors, selectedDay.id)} className="h-3 w-3" />
                <span className="truncate">Day {selectedDay.day_number}{selectedDay.date ? ` · ${formatDateOnly(selectedDay.date)}` : ""}{selectedDay.title ? ` · ${selectedDay.title}` : ""}</span>
              </div>
            ) : null}
          </MapView>
        </div>
      </div>
      {!panel ? <div inert={overlayOpen}><MobileSheet trip={data.trip} days={data.days} dayStats={dayStats} dayColors={dayColors} selectedDayId={selectedDayId} onSelectDay={selectDay} onStepDay={stepDay} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} showLayerControls={mapActionsEnabled} mapAvailable={mapActionsEnabled} onStartPhotoUpload={canContribute ? () => startPanel("photo") : undefined} onStartAddNote={canContribute && mapActionsEnabled ? () => startPanel("note") : undefined} onStartRouteDraw={isAdmin && mapActionsEnabled ? () => startPanel("route") : undefined} journey={journeyEntry} counts={{ routes: filtered.routes.length, photos: filtered.photos.filter((photo) => photo.media_type !== "video").length, videos: filtered.photos.filter((photo) => photo.media_type === "video").length, notes: filtered.notes.length, places: filtered.places.length }} notesPlaces={notesPlacesEntry} adminData={adminData} memberAdmin={memberAdmin} adminRequest={adminRequest} /></div> : null}
      {loading ? <StatusPill><Loader2 className="h-4 w-4 motion-safe:animate-spin text-teal-700" /> Loading trip data…</StatusPill> : null}
      {notice && !error ? <StatusPill onDismiss={() => setNotice(null)}>{notice}</StatusPill> : null}
      {shareStatus && !error ? <StatusPill>{shareStatus === "copied" ? "Link copied" : shareStatus === "shared" ? "Link shared" : "Couldn’t copy the link"}</StatusPill> : null}
      {error ? <StatusPill tone="error" onDismiss={() => setError(null)}><AlertCircle className="h-4 w-4 shrink-0 text-rose-600" /> {error}</StatusPill> : null}
      {backend && !authLoading && !user && authPanelOpen ? <AuthPanel tripTitle={data.trip?.title ?? null} message={authMessage} messageTone={authMessageTone} isSubmitting={authSubmitting} pendingOtpEmail={pendingOtpEmail} onSignIn={signIn} onVerifyCode={verifyCode} onCancelCodeEntry={cancelCodeEntry} onSignInWithGoogle={signInWithGoogle} onClose={() => setAuthPanelOpen(false)} /> : null}
      {backend && user && currentMember && profilesAvailable && canContribute && profilePanelOpen ? <ProfilePanel displayName={currentMember.display_name} avatarUrl={currentMember.avatar_url} email={user.email ?? null} isSaving={profileSaving} onClose={() => setProfilePanelOpen(false)} onSave={saveProfile} /> : null}
      {panel === "note" ? <AddNotePanel tripSlug={tripSlug} days={data.days} selectedCoordinate={pendingCoordinate} defaultDayId={selectedDayId} isSaving={saving} onCancel={closePanel} onSave={saveNote} /> : null}
      {panel === "photo" ? <UploadPhotoPanel days={data.days} routes={data.routeSegments} existingPhotos={data.photos} tripSlug={tripSlug} mapAvailable={mapActionsEnabled} defaultDayId={selectedDayId} pendingCoordinate={pendingCoordinate} isSaving={saving} onCancel={closePanel} onCoordinatePreview={setPendingCoordinate} onSave={savePhotos} /> : null}
      {panel === "route" ? <ManualRoutePanel days={data.days} defaultDayId={selectedDayId} points={routeDraftPoints} distanceMeters={routeDraftDistance} isSaving={saving} onCancel={closePanel} onUndoPoint={() => setRouteDraftPoints((current) => current.slice(0, -1))} onClear={() => setRouteDraftPoints([])} onSave={saveRoute} /> : null}
      {/* ?item= links restore the editor for anyone; only open it for viewers who can save. */}
      {editTarget && canContribute ? <EditItemPanel target={editTarget} days={data.days} isSaving={adminStatus.isSaving} onClose={closeEditItem} onUpdatePhoto={updatePhoto} onUpdateNote={updateNote} onUpdatePlace={updatePlace} onUpdateRoute={updateRoute} onDeleteItem={deleteDataItem} /> : null}
      {journeyOpen ? (
        <JourneyPlayback
          trip={data.trip}
          showIntro={journeyIntro}
          items={journeyItems}
          allItems={allJourneyItems}
          activeIndex={Math.max(0, activeJourneyIndex)}
          days={data.days}
          routes={data.routeSegments}
          filter={journeyFilter}
          uploaderFilter={journeyUploaderFilter}
          currentUserId={mutationUserId}
          isAdmin={isAdmin}
          isSaving={adminStatus.isSaving}
          onFilterChange={setJourneyFilter}
          onUploaderFilterChange={setJourneyUploaderFilter}
          onSelectIndex={selectJourneyIndex}
          onSelectItem={selectJourneyItem}
          onNext={nextJourneyItem}
          onPrev={prevJourneyItem}
          onClose={closeJourney}
          onUpdatePhoto={updatePhoto}
          onEditPhoto={editPhotoFromJourney}
        />
      ) : null}
    </main>
  );
}
