"use client";

import dynamic from "next/dynamic";
// Types only — a value import of mapbox-gl here would pull the whole library
// into the initial bundle and defeat MapView's dynamic() split.
import type { Map as MapboxMap } from "mapbox-gl";
import { collectItemCoordinates, coordinateBounds, lineDistanceMeters, routeDistanceMeters, routeGeometry } from "@/lib/geo";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Loader2, LogIn, Mail, Play, ShieldCheck, Sparkles, UserRound, X } from "lucide-react";
import { DaySidebar } from "@/components/DaySidebar";
import type { JourneyFilter } from "@/components/JourneyPlayback";
import { MapLegend } from "@/components/MapLegend";
import { MobileSheet } from "@/components/MobileSheet";
import type { MapItemKind } from "@/components/TripLayers";
import { EditItemPanel, type EditTarget } from "@/components/EditItemPanel";
import { deriveTripAccess } from "@/lib/access";
import { demoTripData, emptyTripData } from "@/lib/demo-trip";
import { firstBucketDate, groupPointsByDay, parseGpx, simplifyToLineString } from "@/lib/gpx";
import { useTripAuth } from "@/lib/hooks/useTripAuth";
import { useTripData } from "@/lib/hooks/useTripData";
import { buildJourneyItems } from "@/lib/journey";
import type { PhotoOutlier } from "@/lib/photo-outliers";
import { clearNoteDraft } from "@/lib/offline-drafts";
import { prepareAvatarFile } from "@/lib/avatar-processing";
import { prepareMediaFiles } from "@/lib/media-processing";
import { uploadPhotoBatch } from "@/lib/photo-upload";
import { AVATAR_BUCKET, IMMUTABLE_CACHE_SECONDS, PHOTO_BUCKET, getSupabaseBrowserClient, resolvePhotoUrls } from "@/lib/supabase";
import { applyTripUrlState, formatDayParam, formatItemToken, parseItemToken, readTripUrlState, resolveDayParam } from "@/lib/trip-url";
import { cn } from "@/lib/utils";
import type { Day, LngLat, MapClickMode, Note, RouteMode, RouteSegment } from "@/types/trip";
import type { PhotoUploadItemInput, PhotoUploadProgress, PhotoUploadSaveResult } from "@/components/UploadPhotoPanel";

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
const UPLOAD_CONCURRENCY = 4;

export default function Home() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const tripSlug = process.env.NEXT_PUBLIC_TRIP_SLUG ?? "lofoten-2026";
  const {
    user,
    authLoading,
    authMessage,
    authMessageTone,
    authSubmitting,
    authPanelOpen,
    setAuthPanelOpen,
    signIn,
    signInWithGoogle,
    signOut,
  } = useTripAuth(supabase);
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
    supabase,
    user,
    authLoading,
    tripSlug,
    initialData: supabase ? emptyTripData : demoTripData,
  });
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
  const [map, setMap] = useState<MapboxMap | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [panel, setPanel] = useState<"photo" | "note" | "route" | null>(null);
  const [editTargetRef, setEditTargetRef] = useState<{ kind: MapItemKind; id: string } | null>(null);
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);
  const [lastFocusedPhotoId, setLastFocusedPhotoId] = useState<string | null>(null);
  const [outlierPreview, setOutlierPreview] = useState<PhotoOutlier | null>(null);
  const [deepLinkChecked, setDeepLinkChecked] = useState(false);
  const [journeyFilter, setJourneyFilter] = useState<JourneyFilter>("all");
  const [journeyUploaderFilter, setJourneyUploaderFilter] = useState("");
  const [saving, setSaving] = useState(false);

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
      onPreviewOutlier: previewOutlier,
    }
    : null;
  // Map-friendly shape of the previewed outlier (drops photos with no coords).
  const outlierOverlay = useMemo(() => {
    if (!outlierPreview || outlierPreview.photo.lng === null || outlierPreview.photo.lat === null) return null;
    return {
      photo: { lng: outlierPreview.photo.lng, lat: outlierPreview.photo.lat },
      suggested: outlierPreview.suggested,
      neighbors: outlierPreview.neighbors,
    };
  }, [outlierPreview]);

  const selectDay = useCallback((dayId: string | null) => {
    setSelectedDayId(dayId);
    // Switching days is a deliberate change of context, so any lingering
    // photo-popup focus stops steering where Journey Mode starts.
    setLastFocusedPhotoId(null);
    if (typeof window === "undefined") return;
    applyTripUrlState(window.location.href, { day: formatDayParam(dayId, data.days) });
  }, [data.days]);

  // A photo only steers the journey start while its popup is open. Guarded so
  // closing a stale popup can't wipe focus from a newer one opened after it.
  const handlePhotoBlur = useCallback((photoId: string) => {
    setLastFocusedPhotoId((current) => (current === photoId ? null : current));
  }, []);

  const openJourneyAt = useCallback((itemId: string, mode: "push" | "replace" = "push") => {
    setActiveJourneyId(itemId);
    if (typeof window === "undefined") return;
    applyTripUrlState(window.location.href, { journey: itemId, item: null }, mode);
  }, []);

  const closeJourney = useCallback(() => {
    setActiveJourneyId(null);
    if (typeof window === "undefined") return;
    applyTripUrlState(window.location.href, { journey: null });
  }, []);

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
    openJourneyAt((lastFocused ?? dayStart ?? journeyItems[0]).id);
  }, [journeyItems, lastFocusedPhotoId, openJourneyAt, selectedDayId]);

  // Step the map-view day filter forward/backward through ["All days", day 1,
  // day 2, ...], clamped at both ends so repeated presses don't wrap around.
  const stepDay = useCallback((direction: 1 | -1) => {
    const sequence: Array<string | null> = [null, ...data.days.map((day) => day.id)];
    const currentIndex = Math.max(0, sequence.indexOf(selectedDayId));
    const nextIndex = Math.min(sequence.length - 1, Math.max(0, currentIndex + direction));
    if (nextIndex !== currentIndex) selectDay(sequence[nextIndex]);
  }, [data.days, selectDay, selectedDayId]);

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

  const applyDeepLinkFromUrl = useCallback((href: string) => {
    const { day, journey, item } = readTripUrlState(href);
    const dayId = resolveDayParam(day, data.days);
    setSelectedDayId(dayId);

    const journeyToken = journey && allJourneyItems.some((entry) => entry.id === journey) ? journey : null;
    setActiveJourneyId(journeyToken);

    const itemRef = parseItemToken(item);
    if (!itemRef) {
      setEditTargetRef(null);
      return;
    }
    if (itemRef.kind === "photo") {
      const photo = data.photos.find((entry) => entry.id === itemRef.id);
      if (photo) {
        setJourneyFilter("all");
        setJourneyUploaderFilter("");
        setActiveJourneyId(`photo:${photo.id}`);
        setEditTargetRef(null);
        return;
      }
    }
    const exists = (
      (itemRef.kind === "photo" && data.photos.some((entry) => entry.id === itemRef.id))
      || (itemRef.kind === "note" && data.notes.some((entry) => entry.id === itemRef.id))
      || (itemRef.kind === "place" && data.places.some((entry) => entry.id === itemRef.id))
      || (itemRef.kind === "route" && data.routeSegments.some((entry) => entry.id === itemRef.id))
    );
    setEditTargetRef(exists ? { kind: itemRef.kind, id: itemRef.id } : null);
  }, [allJourneyItems, data.days, data.notes, data.photos, data.places, data.routeSegments]);

  useEffect(() => {
    if (deepLinkChecked || loading) return;
    applyDeepLinkFromUrl(window.location.href);
    setDeepLinkChecked(true);
  }, [applyDeepLinkFromUrl, deepLinkChecked, loading]);

  useEffect(() => {
    const handler = () => applyDeepLinkFromUrl(window.location.href);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [applyDeepLinkFromUrl]);

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
    setPanel(null);
  }, []);

  // Keep the latest filtered items in a ref so the framing effect below can read
  // them without re-firing every time realtime data updates — we only want to
  // recenter when the selected day (or map readiness) actually changes.
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  // Center the map on the active day (or all days) whenever the selection
  // changes: build a bounding box around that day's items and fit it with
  // padding. Mobile gets extra bottom padding so the bottom sheet doesn't cover
  // the framed content; a lone point falls back to an eased zoom since a
  // zero-area box can't be fit.
  useEffect(() => {
    if (!map) return;
    const coords = collectItemCoordinates(filteredRef.current);
    if (coords.length === 0) return;

    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    const padding = isMobile
      ? { top: 96, right: 48, bottom: 220, left: 48 }
      : { top: 80, right: 80, bottom: 80, left: 80 };

    const bounds = coordinateBounds(coords);
    if (!bounds) return;

    if (bounds.diagonalMeters < 1) {
      map.easeTo({ center: bounds.center, zoom: 13.5, padding, duration: 800, essential: true });
      return;
    }
    map.fitBounds([bounds.sw, bounds.ne], { padding, maxZoom: 14, duration: 800, essential: true });
  }, [map, selectedDayId]);

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
    applyTripUrlState(window.location.href, { item: formatItemToken({ kind, id }), journey: null }, "push");
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
        essential: true,
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
    const isMobile = window.innerWidth < 768;
    const padding = isMobile ? { top: 96, right: 48, bottom: 220, left: 48 } : { top: 80, right: 80, bottom: 80, left: 80 };
    map.fitBounds([bounds.sw, bounds.ne], { padding, maxZoom: 14, duration: 800, essential: true });
  }

  // A photo marker was dragged to a new spot. Update local state immediately so
  // the marker stays where it was dropped while the save round-trips; on error
  // updatePhoto surfaces the failure and the next load restores server truth.
  async function movePhoto(photoId: string, coordinate: LngLat) {
    const photo = data.photos.find((item) => item.id === photoId);
    if (!photo) return;
    setData((current) => ({
      ...current,
      photos: current.photos.map((item) => item.id === photoId ? { ...item, lat: coordinate.lat, lng: coordinate.lng } : item),
    }));
    await updatePhoto(photoId, {
      day_id: photo.day_id,
      uploader_name: photo.uploader_name,
      caption: photo.caption,
      lat: coordinate.lat,
      lng: coordinate.lng,
      taken_at: photo.taken_at,
    });
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
      if (didSave) {
        clearNoteDraft(tripSlug);
        closePanel();
      }
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
          const prepared = await prepareMediaFiles(input.file);
          const row = {
            id: crypto.randomUUID(),
            trip_id: data.trip!.id,
            day_id: input.dayId,
            user_id: user?.id ?? null,
            uploader_name: uploaderName,
            content_hash: input.contentHash,
            media_type: input.mediaType,
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
          setError("Sign in before uploading media to Supabase.");
          return;
        }
        const outcome = await uploadPhotoBatch({
          supabase,
          trip: { id: data.trip.id, slug: data.trip.slug },
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
          // every table; the realtime echo of this insert upserts by id, so
          // the two paths converge instead of duplicating.
          const resolved = resolvePhotoUrls(supabase, outcome.insertedRows);
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
        // .select() makes the update report which rows it touched: RLS filters
        // silently (no error, zero rows), which would otherwise show "Photo
        // updated." while writing nothing — and leave an optimistic marker
        // move on screen that reverts on the next load.
        const { data: updatedRows, error: updateError } = await supabase.from("photos").update(input).eq("id", photoId).eq("trip_id", data.trip!.id).select("id");
        if (updateError) setAdminDataError(updateError.message);
        else if (!updatedRows || updatedRows.length === 0) {
          setAdminDataError("The change was not saved — you may not have permission to edit this photo.");
          await loadData();
        } else {
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
          if (table === "days") selectDay(selectedDayId === id ? null : selectedDayId);
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
        if (table === "days") selectDay(selectedDayId === id ? null : selectedDayId);
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
            onClick={startJourney}
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
        <div className="z-10 hidden min-h-0 md:block"><DaySidebar trip={data.trip} days={data.days} selectedDayId={selectedDayId} onSelectDay={selectDay} onStepDay={stepDay} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} showLayerControls={mapActionsEnabled} onStartPhotoUpload={canContribute && mapActionsEnabled ? () => startPanel("photo") : undefined} onStartAddNote={canContribute && mapActionsEnabled ? () => startPanel("note") : undefined} onStartRouteDraw={isAdmin && mapActionsEnabled ? () => startPanel("route") : undefined} adminData={adminData} memberAdmin={memberAdmin} adminRequest={adminRequest} /></div>
        <div className={cn("h-full min-h-0", journeyOpen && "hidden")}>
          <MapView clickMode={clickMode} pendingCoordinate={pendingCoordinate} onMapReady={handleMapReady} onMapUnavailable={handleMapUnavailable} onCoordinatePick={handleCoordinatePick}>
            {!mapUnavailable ? <TripLayers map={map} routes={filtered.routes} photos={filtered.photos} notes={filtered.notes} places={filtered.places} visibility={layerVisibility} currentUserId={currentUserId} isAdmin={isAdmin} onEditItem={startEditFromMap} onDeleteItem={deleteFromMap} onOpenJourney={openJourneyFromMap} onPhotoFocus={setLastFocusedPhotoId} onPhotoBlur={handlePhotoBlur} onMovePhoto={movePhoto} highlightedPhotoId={editTarget?.kind === "photo" ? editTarget.item.id : null} outlierPreview={outlierOverlay} /> : null}
            {!mapUnavailable ? <RouteDraftLayer map={map} points={routeDraftPoints} /> : null}
            {!mapUnavailable ? <MapLegend visibility={layerVisibility} /> : null}
          </MapView>
        </div>
      </div>
      {!panel ? <MobileSheet trip={data.trip} days={data.days} selectedDayId={selectedDayId} onSelectDay={selectDay} onStepDay={stepDay} layerVisibility={layerVisibility} onLayerVisibilityChange={setLayerVisibility} showLayerControls={mapActionsEnabled} mapAvailable={mapActionsEnabled} onStartPhotoUpload={canContribute && mapActionsEnabled ? () => startPanel("photo") : undefined} onStartAddNote={canContribute && mapActionsEnabled ? () => startPanel("note") : undefined} onStartRouteDraw={isAdmin && mapActionsEnabled ? () => startPanel("route") : undefined} counts={{ routes: filtered.routes.length, photos: filtered.photos.length, notes: filtered.notes.length, places: filtered.places.length }} adminData={adminData} memberAdmin={memberAdmin} adminRequest={adminRequest} /> : null}
      {loading ? <StatusPill><Loader2 className="h-4 w-4 animate-spin text-teal-700" /> Loading trip data…</StatusPill> : null}
      {notice && !error ? <StatusPill onDismiss={() => setNotice(null)}>{notice}</StatusPill> : null}
      {error ? <StatusPill tone="error" onDismiss={() => setError(null)}><AlertCircle className="h-4 w-4 shrink-0 text-rose-600" /> {error}</StatusPill> : null}
      {supabase && !authLoading && !user && authPanelOpen ? <AuthPanel message={authMessage} messageTone={authMessageTone} isSubmitting={authSubmitting} onSignIn={signIn} onSignInWithGoogle={signInWithGoogle} onClose={() => setAuthPanelOpen(false)} /> : null}
      {supabase && user && currentMember && profilesAvailable && profilePanelOpen ? <ProfilePanel displayName={currentMember.display_name} avatarUrl={currentMember.avatar_url} email={user.email ?? null} isSaving={profileSaving} onClose={() => setProfilePanelOpen(false)} onSave={saveProfile} /> : null}
      {panel === "note" ? <AddNotePanel tripSlug={tripSlug} days={data.days} selectedCoordinate={pendingCoordinate} defaultDayId={selectedDayId} isSaving={saving} onCancel={closePanel} onSave={saveNote} /> : null}
      {panel === "photo" ? <UploadPhotoPanel days={data.days} routes={data.routeSegments} defaultDayId={selectedDayId} pendingCoordinate={pendingCoordinate} isSaving={saving} onCancel={closePanel} onCoordinatePreview={setPendingCoordinate} onSave={savePhotos} /> : null}
      {panel === "route" ? <ManualRoutePanel days={data.days} defaultDayId={selectedDayId} points={routeDraftPoints} distanceMeters={routeDraftDistance} isSaving={saving} onCancel={closePanel} onUndoPoint={() => setRouteDraftPoints((current) => current.slice(0, -1))} onClear={() => setRouteDraftPoints([])} onSave={saveRoute} /> : null}
      {editTarget ? <EditItemPanel target={editTarget} days={data.days} isSaving={adminDataSaving} onClose={() => { setEditTargetRef(null); applyTripUrlState(window.location.href, { item: null }); }} onUpdatePhoto={updatePhoto} onUpdateNote={updateNote} onUpdatePlace={updatePlace} onUpdateRoute={updateRoute} onDeleteItem={deleteDataItem} /> : null}
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
          onEditPhoto={editPhotoFromJourney}
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
