"use client";

import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, FileImage, Images, Loader2, MapPin, RotateCcw, Trash2, Upload, Video, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { mapWithConcurrency } from "@/lib/concurrency";
import { extractPhotoExif, type ExtractedExif } from "@/lib/exif";
import { fileContentHash } from "@/lib/file-hash";
import { detectMediaType } from "@/lib/media-processing";
import {
  coordinateKey,
  dayLabel,
  findDayIdForCoordinate,
  findDayIdForExifDate,
  formatBytes,
  locationLabel,
  mediaLabel,
  routePlaceNoGpsItems,
  routePlaceQueueItems,
  stepFlow,
  type QueueFilter,
  type QueueItem,
  type Step,
} from "@/lib/upload-queue";
import { cn } from "@/lib/utils";
import type { Day, LngLat, RouteSegment } from "@/types/trip";

export type PhotoUploadItemInput = {
  clientId: string;
  file: File;
  mediaType: "photo" | "video";
  contentHash: string;
  caption: string;
  dayId: string | null;
  coordinate: LngLat;
  exif: ExtractedExif | null;
};

export type PhotoUploadSaveResult = {
  savedClientIds: string[];
  failedClientIds: string[];
};

export type PhotoUploadProgress = {
  completed: number;
  total: number;
};

type Props = {
  days: Day[];
  routes: RouteSegment[];
  defaultDayId: string | null;
  pendingCoordinate: LngLat | null;
  isSaving: boolean;
  onCancel: () => void;
  onCoordinatePreview: (coordinate: LngLat | null) => void;
  onSave: (items: PhotoUploadItemInput[], onProgress: (progress: PhotoUploadProgress) => void) => Promise<PhotoUploadSaveResult | void>;
};

const MAX_IMAGE_FILE_SIZE = 30 * 1024 * 1024;
const MAX_VIDEO_FILE_SIZE = 250 * 1024 * 1024;
const EXIF_CONCURRENCY = 4;
const FINGERPRINT_CONCURRENCY = 2;
const VIDEO_FINGERPRINT_CONCURRENCY = 1;
const LARGE_BATCH_THRESHOLD = 50;
const QUEUE_PREVIEW_LIMIT = 40;
const BATCH_OVERRIDE_IDLE = "__idle";
const ALL_DAYS_VALUE = "__all";

const STEP_TITLES: Record<Step, string> = {
  select: "Add photos",
  review: "Review",
  place: "Place on map",
};

export function UploadPhotoPanel({ days, routes, defaultDayId, pendingCoordinate, isSaving, onCancel, onCoordinatePreview, onSave }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  // Lets the map-tap effect target the active photo without depending on
  // activeItemId — so merely selecting a photo never triggers a coordinate write.
  const activeItemIdRef = useRef(activeItemId);
  const [batchOverrideDayId, setBatchOverrideDayId] = useState(BATCH_OVERRIDE_IDLE);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [step, setStep] = useState<Step>("select");
  const [uploadProgress, setUploadProgress] = useState<PhotoUploadProgress | null>(null);
  const [showAllQueueItems, setShowAllQueueItems] = useState(false);
  // When placing, the overlay collapses to a slim bar so the live map underneath
  // is tappable; the existing pendingCoordinate feedback loop assigns the pin.
  // "bulk" walks through every unplaced photo in turn; "single" stays on one
  // chosen photo so its pin can be nudged with repeated map taps.
  const [placeMode, setPlaceMode] = useState<"bulk" | "single" | null>(null);
  const minimized = placeMode !== null;
  const previewCoordinateKeyRef = useRef<string | null>(null);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);

  const visibleItems = useMemo(() => {
    if (queueFilter === "all") return items;
    if (queueFilter === "review") return items.filter((item) => item.status !== "invalid" && (item.status === "needs-location" || item.dayId === null));
    return items.filter((item) => item.status === queueFilter);
  }, [items, queueFilter]);
  const activeItem = (activeItemId ? items.find((item) => item.id === activeItemId) : null) ?? visibleItems[0] ?? items[0] ?? null;
  const activeFile = activeItem?.file ?? null;

  const counts = useMemo(() => ({
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    needsLocation: items.filter((item) => item.status === "needs-location").length,
    reading: items.filter((item) => item.status === "reading").length,
    invalid: items.filter((item) => item.status === "invalid").length,
    matchedByDate: items.filter((item) => item.dayMatchSource === "date").length,
    matchedByRoute: items.filter((item) => item.dayMatchSource === "route").length,
    placedOnRoute: items.filter((item) => item.locationSource === "route").length,
    unassigned: items.filter((item) => item.status !== "invalid" && item.dayId === null).length,
    review: items.filter((item) => item.status !== "invalid" && (item.status === "needs-location" || item.dayId === null)).length,
  }), [items]);
  const isLargeBatch = counts.total >= LARGE_BATCH_THRESHOLD;
  const displayedItems = isLargeBatch && !showAllQueueItems ? visibleItems.slice(0, QUEUE_PREVIEW_LIMIT) : visibleItems;
  const hiddenVisibleCount = Math.max(0, visibleItems.length - displayedItems.length);
  const preparedCount = counts.total - counts.reading;
  const prepareProgressPercent = counts.total > 0 ? Math.round((preparedCount / counts.total) * 100) : 0;

  const placementItems = useMemo(() => items.filter((item) => item.status === "needs-location"), [items]);
  const placedCount = counts.ready;
  const placementTotal = placedCount + counts.needsLocation;

  const dayBuckets = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const item of items) {
      if (item.status === "invalid") continue;
      const key = item.dayId ?? "";
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries()).map(([key, count]) => ({ dayId: key || null, count }));
  }, [items]);

  const steps = stepFlow(placementTotal > 0);
  const stepIndex = Math.max(0, steps.indexOf(step));

  useEffect(() => {
    if (!activeFile) {
      setActivePreviewUrl(null);
      return;
    }
    const previewUrl = URL.createObjectURL(activeFile);
    setActivePreviewUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [activeFile]);

  // Mirror the active photo's coordinate to the map marker. The ref guards against
  // reacting to our own echo when the parent feeds the same coordinate back in.
  useEffect(() => {
    if (activeItem?.coordinate) {
      previewCoordinateKeyRef.current = coordinateKey(activeItem.coordinate);
      onCoordinatePreview(activeItem.coordinate);
      return;
    }
    previewCoordinateKeyRef.current = null;
    onCoordinatePreview(null);
  }, [activeItem?.coordinate, activeItem?.id, activeItem?.status, onCoordinatePreview]);

  useEffect(() => {
    activeItemIdRef.current = activeItemId;
  }, [activeItemId]);

  // A genuine map tap (key differs from our echo) assigns the location to the
  // active photo. This must depend ONLY on pendingCoordinate — if it also reacted
  // to activeItemId, simply selecting a photo would write a stale pending pin onto
  // it, flipping it to "ready" and making it vanish from the needs-location list.
  useEffect(() => {
    if (!pendingCoordinate) return;
    const targetId = activeItemIdRef.current;
    if (!targetId) return;
    const nextKey = coordinateKey(pendingCoordinate);
    if (previewCoordinateKeyRef.current === nextKey) {
      previewCoordinateKeyRef.current = null;
      return;
    }
    setItems((current) => current.map((item) => item.id === targetId && item.status !== "invalid" && item.status !== "reading"
      ? { ...item, coordinate: pendingCoordinate, locationSource: "manual", status: "ready", message: "Location set from the map." }
      : item));
  }, [pendingCoordinate]);

  // Keep the active selection valid as the filtered list changes.
  useEffect(() => {
    if (items.length === 0) {
      if (activeItemId !== null) setActiveItemId(null);
      return;
    }
    if (activeItemId && items.some((item) => item.id === activeItemId)) return;
    setActiveItemId((visibleItems[0] ?? items[0]).id);
  }, [activeItemId, items, visibleItems]);

  // In bulk placement, advance to the next photo needing a pin once the current
  // one is placed; collapse the bar and jump to upload when the queue is cleared.
  // Single placement intentionally stays put so the user can nudge the same pin.
  useEffect(() => {
    if (placeMode !== "bulk") return;
    if (activeItem && activeItem.status === "needs-location") return;
    const next = items.find((item) => item.status === "needs-location");
    if (next) {
      setActiveItemId(next.id);
    } else {
      setPlaceMode(null);
      setStep("review");
    }
  }, [placeMode, activeItem, items]);

  // Reset to the picker whenever the queue empties (clear, or all removed).
  useEffect(() => {
    if (items.length === 0 && step !== "select") {
      setStep("select");
      setQueueFilter("all");
      setBatchOverrideDayId(BATCH_OVERRIDE_IDLE);
    }
  }, [items.length, step]);

  async function handleFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;
    setBatchOverrideDayId(BATCH_OVERRIDE_IDLE);
    if (selected.length >= LARGE_BATCH_THRESHOLD) setShowAllQueueItems(false);
    const existingHashes = new Set(items.map((item) => item.contentHash).filter((hash): hash is string => Boolean(hash)));
    const selectedHashes = new Set<string>();

    const nextItems: QueueItem[] = selected.map((file) => {
      const id = crypto.randomUUID();
      const mediaType = detectMediaType(file);
      if (!mediaType) {
        return { id, file, mediaType: "photo", contentHash: null, caption: "", dayId: null, dayMatchSource: null, locationSource: null, exif: null, coordinate: null, status: "invalid", message: "Unsupported file type." };
      }
      const maxSize = mediaType === "video" ? MAX_VIDEO_FILE_SIZE : MAX_IMAGE_FILE_SIZE;
      if (file.size > maxSize) {
        return { id, file, mediaType, contentHash: null, caption: "", dayId: null, dayMatchSource: null, locationSource: null, exif: null, coordinate: null, status: "invalid", message: `Over ${formatBytes(maxSize)}. Export a smaller copy first.` };
      }
      return { id, file, mediaType, contentHash: null, caption: "", dayId: defaultDayId, dayMatchSource: null, locationSource: null, exif: null, coordinate: null, status: "reading", message: `Preparing ${mediaType}...` };
    });

    setItems((current) => [...current, ...nextItems]);
    setActiveItemId((current) => current ?? nextItems[0]?.id ?? null);
    // Move past the picker as soon as files land; analysis fills in below.
    setStep((current) => (current === "select" ? "review" : current));

    const readable = nextItems.filter((item) => item.status === "reading");
    const fingerprinted: QueueItem[] = [];
    async function fingerprintItem(item: QueueItem) {
      try {
        const contentHash = await fileContentHash(item.file);
        if (existingHashes.has(contentHash) || selectedHashes.has(contentHash)) {
          setItems((current) => current.map((currentItem) => currentItem.id === item.id
            ? { ...currentItem, contentHash, status: "invalid", message: `Duplicate ${mediaLabel(item.mediaType)} already in this upload queue.` }
            : currentItem));
          return;
        }
        selectedHashes.add(contentHash);
        fingerprinted.push({ ...item, contentHash, message: `Reading ${mediaLabel(item.mediaType)} metadata...` });
        setItems((current) => current.map((currentItem) => currentItem.id === item.id
          ? { ...currentItem, contentHash, message: `Reading ${mediaLabel(item.mediaType)} metadata...` }
          : currentItem));
      } catch {
        setItems((current) => current.map((currentItem) => currentItem.id === item.id
          ? { ...currentItem, status: "invalid", message: `We could not fingerprint this ${mediaLabel(item.mediaType)}.` }
          : currentItem));
      }
    }
    const photoItems = readable.filter((item) => item.mediaType === "photo");
    const videoItems = readable.filter((item) => item.mediaType === "video");
    await mapWithConcurrency(photoItems, FINGERPRINT_CONCURRENCY, fingerprintItem);
    await mapWithConcurrency(videoItems, VIDEO_FINGERPRINT_CONCURRENCY, fingerprintItem);

    const extracted = new Map<string, ExtractedExif>();
    await mapWithConcurrency(fingerprinted, EXIF_CONCURRENCY, async (item) => {
      const exif = await extractPhotoExif(item.file, { mediaType: item.mediaType });
      extracted.set(item.id, exif);
    });

    const analyzed = routePlaceNoGpsItems(fingerprinted.map((item, order) => {
      const exif = extracted.get(item.id);
      if (!exif) {
        return { id: item.id, order, dayId: item.dayId, dayMatchSource: null, locationSource: null, exif: null, coordinate: null, status: "invalid" as const, message: `We could not read this ${mediaLabel(item.mediaType)}.` };
      }
      const coordinate = exif.lat !== null && exif.lng !== null ? { lat: exif.lat, lng: exif.lng } : null;
      const matchedDayId = findDayIdForExifDate(days, exif);
      const routeDayId = matchedDayId ? null : findDayIdForCoordinate(routes, coordinate);
      return {
        id: item.id,
        order,
        dayId: matchedDayId ?? routeDayId ?? item.dayId,
        dayMatchSource: matchedDayId ? "date" as const : routeDayId ? "route" as const : null,
        locationSource: coordinate ? "gps" as const : null,
        exif,
        coordinate,
        status: coordinate ? "ready" as const : "needs-location" as const,
        message: exif.message,
      };
    }), routes);
    const analyzedById = new Map(analyzed.map((item) => [item.id, item]));

    setItems((current) => current.map((currentItem) => {
      const analyzedItem = analyzedById.get(currentItem.id);
      if (!analyzedItem) return currentItem;
      return {
        ...currentItem,
        dayId: analyzedItem.dayId,
        dayMatchSource: analyzedItem.dayMatchSource,
        locationSource: analyzedItem.locationSource,
        exif: analyzedItem.exif,
        coordinate: analyzedItem.coordinate,
        status: analyzedItem.status,
        message: analyzedItem.message,
      };
    }));
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    void handleFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  async function submit() {
    const readyItems = items.filter((item) => item.status === "ready" && item.coordinate && item.contentHash);
    if (readyItems.length === 0) return;
    setUploadProgress({ completed: 0, total: readyItems.length });
    const result = await onSave(readyItems.map((item) => ({
      clientId: item.id,
      file: item.file,
      mediaType: item.mediaType,
      contentHash: item.contentHash!,
      caption: item.caption,
      dayId: item.dayId,
      coordinate: item.coordinate!,
      exif: item.exif,
    })), setUploadProgress);
    setUploadProgress(null);
    if (!result || result.savedClientIds.length === 0 || result.failedClientIds.length === 0) return;
    const savedIds = new Set(result.savedClientIds);
    setItems((current) => current.filter((item) => !savedIds.has(item.id)));
    setActiveItemId(result.failedClientIds[0] ?? null);
  }

  function setActiveDay(nextDayId: string) {
    if (!activeItem) return;
    setItems((current) => routePlaceQueueItems(current.map((item) => {
      if (item.id !== activeItem.id) return item;
      const dayId = nextDayId || null;
      return {
        ...item,
        dayId,
        dayMatchSource: null,
        locationSource: item.coordinate ? item.locationSource : null,
        status: item.status === "invalid" || item.status === "reading" || item.coordinate ? item.status : "needs-location",
        message: item.coordinate || !dayId ? item.message : "Day set. Tap map to place if it is not on the route.",
      };
    }), routes));
  }

  function applyBatchDay(nextDayId: string) {
    if (nextDayId === BATCH_OVERRIDE_IDLE) return;
    setBatchOverrideDayId(BATCH_OVERRIDE_IDLE);
    const dayId = nextDayId === ALL_DAYS_VALUE ? null : nextDayId;
    setItems((current) => routePlaceQueueItems(current.map((item) => {
      if (item.status === "invalid") return item;
      return {
        ...item,
        dayId,
        dayMatchSource: null,
        locationSource: item.coordinate ? item.locationSource : null,
        status: item.status === "reading" || item.coordinate ? item.status : "needs-location",
        message: item.coordinate || !dayId ? item.message : "Day set. Tap map to place if it is not on the route.",
      };
    }), routes));
  }

  function removeItem(itemId: string) {
    setItems((current) => {
      const removedIndex = current.findIndex((item) => item.id === itemId);
      const nextItems = current.filter((item) => item.id !== itemId);
      if (nextItems.length === 0) {
        setActiveItemId(null);
        onCoordinatePreview(null);
        return nextItems;
      }
      if (activeItemId === itemId) {
        const nextActiveIndex = Math.min(Math.max(removedIndex, 0), nextItems.length - 1);
        setActiveItemId(nextItems[nextActiveIndex].id);
      }
      return nextItems;
    });
  }

  function clearQueue() {
    setItems([]);
    setUploadProgress(null);
    setShowAllQueueItems(false);
    setActiveItemId(null);
    setQueueFilter("all");
    setBatchOverrideDayId(BATCH_OVERRIDE_IDLE);
    setPlaceMode(null);
    onCoordinatePreview(null);
  }

  function goToReview() {
    setPlaceMode(null);
    setStep("review");
  }

  // Collapse the overlay onto a target photo so the map underneath can be tapped.
  // "single" nudges one chosen photo; "bulk" walks the whole unplaced queue.
  function startPlacing(itemId?: string, mode: "bulk" | "single" = "bulk") {
    const target = (itemId ? items.find((item) => item.id === itemId) : null)
      ?? items.find((item) => item.id === activeItemId && item.status === "needs-location")
      ?? placementItems[0];
    if (!target) {
      setStep("review");
      return;
    }
    setActiveItemId(target.id);
    setPlaceMode(mode);
  }

  // -------- Minimized placement bar (map is fully interactive behind it) --------
  if (minimized) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="pointer-events-auto mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-teal-700/30 bg-[rgba(255,253,246,0.98)] p-3 shadow-[0_20px_60px_rgba(46,61,54,0.3)] backdrop-blur-xl">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-stone-100">
            {activePreviewUrl ? (
              activeItem?.mediaType === "video"
                ? <video src={activePreviewUrl} muted playsInline className="h-full w-full object-cover" />
                // eslint-disable-next-line @next/next/no-img-element -- Object URLs from local files cannot be optimized by next/image.
                : <img src={activePreviewUrl} alt="" className="h-full w-full object-cover" />
            ) : <div className="flex h-full items-center justify-center text-stone-400"><Camera className="h-4 w-4" /></div>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.1em] text-teal-800">
              <MapPin className="h-3.5 w-3.5" /> {placeMode === "single" ? "Tap the map to move this pin" : "Tap the map to place"}
            </div>
            <div className="mt-0.5 truncate text-sm font-bold text-stone-950">{activeItem?.file.name}</div>
            <div className="text-[11px] text-stone-500">{placeMode === "single"
              ? (activeItem?.coordinate ? `${activeItem.coordinate.lat.toFixed(4)}, ${activeItem.coordinate.lng.toFixed(4)} · tap to adjust` : "No location yet")
              : `${placedCount} of ${placementTotal} placed · ${counts.needsLocation} to go`}</div>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <button type="button" onClick={goToReview} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 transition hover:bg-stone-50">{placeMode === "single" ? "Done" : "Back to list"}</button>
            {placeMode === "bulk" && placementItems.length > 1 ? (
              <button type="button" onClick={() => { const next = placementItems.find((item) => item.id !== activeItemId); if (next) setActiveItemId(next.id); }} className="rounded-lg px-3 py-1.5 text-xs font-bold text-stone-500 transition hover:bg-stone-100">Skip this one</button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const placementDone = placementTotal > 0 && counts.needsLocation === 0;

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex flex-col bg-[rgba(255,253,246,0.98)] md:items-center md:justify-center md:bg-stone-950/40 md:p-6 md:backdrop-blur-sm">
      <div className="flex h-full w-full flex-col overflow-hidden md:h-auto md:max-h-[calc(100dvh-3rem)] md:max-w-2xl md:rounded-[1.6rem] md:border md:border-stone-200/80 md:bg-[rgba(255,253,246,0.99)] md:shadow-[0_30px_90px_rgba(46,61,54,0.32)]">
        {/* Header: title + step progress + close. */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-200/70 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.9rem)] md:px-5 md:pt-4">
          <div className="min-w-0">
            <h2 className="font-serif text-2xl font-semibold tracking-tight text-stone-950">{step === "select" ? "Add photos & videos" : STEP_TITLES[step]}</h2>
            <div className="mt-1.5 flex items-center gap-1.5">
              {steps.map((value, index) => (
                <span key={value} className={cn("h-1.5 rounded-full transition-all", index === stepIndex ? "w-6 bg-teal-700" : index < stepIndex ? "w-3 bg-teal-700/50" : "w-3 bg-stone-200")} aria-hidden />
              ))}
              <span className="ml-1 text-[11px] font-bold uppercase tracking-[0.1em] text-stone-400">Step {stepIndex + 1} of {steps.length}</span>
            </div>
          </div>
          <button onClick={onCancel} className="-mr-1 rounded-full p-2 text-stone-500 hover:bg-stone-900/5" aria-label="Close upload"><X className="h-5 w-5" /></button>
        </div>

        <form action={submit} className="flex min-h-0 flex-1 flex-col">
          {/* Scrollable step body. overscroll-contain stops the gesture from
              chaining to the Mapbox canvas behind the overlay. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5">
            {step === "select" ? (
              <div className="flex h-full flex-col">
                <p className="text-sm leading-6 text-stone-600">Choose photos, videos, or a whole camera roll batch. GPS, dates, poster frames, and route placement are prepared on your device before anything uploads.</p>
                <div className="mt-4 grid gap-3">
                  <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-teal-700/35 bg-teal-50 px-4 py-6 text-center text-teal-950 transition hover:bg-teal-100">
                    <Images className="h-7 w-7" />
                    <span className="text-base font-black">Choose from camera roll</span>
                    <span className="text-xs text-teal-900/70">iPhone, Android, HEIC, JPG, MOV, MP4</span>
                    <input name="media" type="file" accept="image/*,video/*,.heic,.heif,.mov,.m4v" multiple className="hidden" onChange={handleFileInputChange} />
                  </label>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-700 transition hover:bg-stone-50">
                    <FileImage className="h-4 w-4" /> Browse exported camera files
                    <input type="file" accept="image/*,video/*,.heic,.heif,.mov,.m4v" multiple className="hidden" onChange={handleFileInputChange} />
                  </label>
                </div>
              </div>
            ) : null}

            {step === "review" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-stone-500">
                  <div className="rounded-md bg-stone-100 px-2 py-2"><span className="block text-sm text-stone-950">{counts.total}</span>Total</div>
                  <div className="rounded-md bg-emerald-50 px-2 py-2 text-emerald-800"><span className="block text-sm">{counts.ready}</span>Ready</div>
                  <div className="rounded-md bg-amber-50 px-2 py-2 text-amber-800"><span className="block text-sm">{counts.needsLocation}</span>Place</div>
                  <div className="rounded-md bg-rose-50 px-2 py-2 text-rose-800"><span className="block text-sm">{counts.invalid}</span>Issues</div>
                </div>

                {isLargeBatch ? (
                  <div className="rounded-lg border border-stone-200 bg-white px-3 py-3 text-xs leading-5 text-stone-700">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-bold text-stone-950">Album import</span>
                      <span className="font-semibold text-stone-500">{preparedCount} of {counts.total} prepared</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100">
                      <div className="h-full rounded-full bg-teal-700 transition-all" style={{ width: `${prepareProgressPercent}%` }} />
                    </div>
                    <div className="mt-2 text-stone-500">
                      {counts.reading > 0
                        ? "Keep this panel open while photos are prepared on your device."
                        : counts.needsLocation > 0
                          ? "Most of the album is ready. Place the photos without GPS, then upload."
                          : "The album is ready to upload."}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-lg border border-teal-700/15 bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-950">
                  <div className="font-bold">{counts.matchedByDate} date matched · {counts.matchedByRoute} GPS near route · {counts.placedOnRoute} route placed · {counts.unassigned} unassigned</div>
                  {dayBuckets.length > 0 ? <div className="mt-1 text-teal-900/80">{dayBuckets.map((bucket) => `${bucket.count} ${dayLabel(days, bucket.dayId)}`).join(" · ")}</div> : null}
                </div>

                <div className="grid grid-cols-4 gap-1 rounded-lg border border-stone-200 bg-white p-1 text-xs font-bold text-stone-600">
                  {([
                    ["all", "All", counts.total],
                    ["review", "Review", counts.review],
                    ["needs-location", "Place", counts.needsLocation],
                    ["invalid", "Issues", counts.invalid],
                  ] as const).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setQueueFilter(key)}
                      className={cn(
                        "rounded-md px-2 py-1.5 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/15",
                        queueFilter === key ? "bg-teal-700 text-white shadow-sm" : "hover:bg-stone-100",
                      )}
                    >
                      {label} <span className={cn("ml-1", queueFilter === key ? "text-white/80" : "text-stone-400")}>{count}</span>
                    </button>
                  ))}
                </div>

                {activeItem ? (
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 rounded-lg border border-stone-200 bg-white p-2 shadow-sm">
                    <div className="h-28 overflow-hidden rounded-md bg-stone-100">
                      {activePreviewUrl ? (
                        activeItem.mediaType === "video"
                          ? <video src={activePreviewUrl} muted playsInline controls className="h-full w-full object-cover" />
                          // eslint-disable-next-line @next/next/no-img-element -- Object URLs from local files cannot be optimized by next/image.
                          : <img src={activePreviewUrl} alt="" className="h-full w-full object-cover" />
                      ) : <div className="flex h-full items-center justify-center text-stone-400"><Camera className="h-5 w-5" /></div>}
                    </div>
                    <div className="min-w-0 py-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 truncate text-sm font-bold text-stone-950">{activeItem.mediaType === "video" ? <Video className="h-3.5 w-3.5 shrink-0" /> : null}{activeItem.file.name}</div>
                          <div className="mt-1 text-xs text-stone-500">{formatBytes(activeItem.file.size)}</div>
                        </div>
                        <button type="button" onClick={() => removeItem(activeItem.id)} disabled={isSaving} className="rounded-md p-1.5 text-stone-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-45" aria-label="Remove selected media">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className={cn("mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-5", activeItem.status === "ready" ? "bg-emerald-50 text-emerald-900" : activeItem.status === "needs-location" ? "bg-amber-50 text-amber-900" : activeItem.status === "invalid" ? "bg-rose-50 text-rose-900" : "bg-stone-100 text-stone-700")}>
                        {activeItem.status === "reading" ? <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin" /> : activeItem.status === "ready" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5" /> : activeItem.status === "invalid" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> : <MapPin className="mt-0.5 h-3.5 w-3.5" />}
                        <span>{activeItem.message}{activeItem.exif?.takenAt ? <> Taken {new Date(activeItem.exif.takenAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.</> : null}</span>
                      </div>
                      {activeItem.status === "needs-location" || activeItem.coordinate ? (
                        <button type="button" onClick={() => startPlacing(activeItem.id, "single")} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-teal-700/30 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-900 transition hover:bg-teal-100">
                          <MapPin className="h-3.5 w-3.5" /> {activeItem.coordinate ? "Move pin on map" : "Place on map"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <textarea value={activeItem?.caption ?? ""} onChange={(event) => {
                  const value = event.target.value;
                  if (!activeItem) return;
                  setItems((current) => current.map((item) => item.id === activeItem.id ? { ...item, caption: value } : item));
                }} maxLength={280} placeholder="Caption for selected media" className="min-h-16 w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />

                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-600">
                  <span>Selected day</span>
                  <select value={activeItem?.dayId ?? ""} onChange={(event) => setActiveDay(event.target.value)} disabled={!activeItem} className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Selected photo day">
                    <option value="">All days</option>
                    {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
                  </select>
                </div>

                <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-600">
                  <span>Override all</span>
                  <select value={batchOverrideDayId} onChange={(event) => applyBatchDay(event.target.value)} className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
                    <option value={BATCH_OVERRIDE_IDLE} disabled>Choose day...</option>
                    <option value={ALL_DAYS_VALUE}>All days</option>
                    {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
                  </select>
                </label>

                <div className="rounded-lg border border-stone-200 bg-white/80 p-2">
                  {visibleItems.length === 0 ? (
                    <div className="flex min-h-20 items-center justify-center rounded-md bg-stone-50 px-3 text-center text-xs leading-5 text-stone-500">No photos in this view.</div>
                  ) : (
                    <div className="space-y-1">
                      {displayedItems.map((item) => {
                        const index = items.findIndex((candidate) => candidate.id === item.id);
                        return (
                          <button type="button" key={item.id} onClick={() => setActiveItemId(item.id)} className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left transition", activeItemId === item.id ? "bg-teal-50 ring-1 ring-teal-700/30" : "hover:bg-stone-100")}>
                            <span className="text-xs font-bold text-stone-400">{index + 1}</span>
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-bold text-stone-900">{item.file.name}</span>
                              <span className="block truncate text-[11px] text-stone-500">{locationLabel(item)}</span>
                              <span className="block truncate text-[11px] font-semibold text-teal-800">{dayLabel(days, item.dayId)}{item.dayMatchSource ? ` · ${item.dayMatchSource} matched` : ""}</span>
                            </span>
                            {item.status === "invalid" ? <AlertTriangle className="h-4 w-4 text-rose-500" /> : <span className={cn("h-2.5 w-2.5 rounded-full", item.status === "ready" ? "bg-emerald-500" : item.status === "needs-location" ? "bg-amber-500" : "bg-stone-300")} />}
                          </button>
                        );
                      })}
                      {hiddenVisibleCount > 0 ? (
                        <button type="button" onClick={() => setShowAllQueueItems(true)} className="mt-2 flex w-full items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-600 transition hover:bg-stone-100">
                          Show {hiddenVisibleCount} more
                        </button>
                      ) : isLargeBatch && showAllQueueItems && visibleItems.length > QUEUE_PREVIEW_LIMIT ? (
                        <button type="button" onClick={() => setShowAllQueueItems(false)} className="mt-2 flex w-full items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-600 transition hover:bg-stone-100">
                          Show fewer
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>

                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-600 transition hover:bg-stone-50">
                  <Images className="h-4 w-4" /> Add more media
                  <input type="file" accept="image/*,video/*,.heic,.heif,.mov,.m4v" multiple className="hidden" onChange={handleFileInputChange} />
                </label>
              </div>
            ) : null}

            {step === "place" ? (
              <div className="space-y-3">
                <p className="text-sm leading-6 text-stone-600">
                  {placementDone
                    ? "Every photo has a location. You can fine-tune any pin or continue to upload."
                    : `${counts.needsLocation} photo${counts.needsLocation === 1 ? "" : "s"} still need a spot on the map. Pick one and tap where it belongs — we keep the map visible while you place it.`}
                </p>

                {placementItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-8 text-center text-emerald-900">
                    <CheckCircle2 className="h-7 w-7" />
                    <span className="text-sm font-bold">All photos are placed.</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {placementItems.map((item) => (
                      <div key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold text-stone-900">{item.file.name}</span>
                          <span className="block truncate text-[11px] text-stone-500">{dayLabel(days, item.dayId)}</span>
                        </span>
                        <button type="button" onClick={() => startPlacing(item.id)} className="flex items-center gap-1 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-teal-800">
                          <MapPin className="h-3.5 w-3.5" /> Place
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Sticky footer with the per-step primary action. */}
          {step !== "select" ? (
            <div className="flex items-center gap-2 border-t border-stone-200/70 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:px-5 md:pb-3">
              {step === "review" ? (
                <>
                  <button type="button" onClick={clearQueue} disabled={isSaving} className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45" aria-label="Clear queue"><RotateCcw className="h-4 w-4" /></button>
                  {counts.needsLocation > 0 ? (
                    <button type="button" onClick={() => setStep("place")} className="flex items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-3 text-sm font-bold text-teal-900 transition hover:bg-teal-100"><MapPin className="h-4 w-4" /> Place {counts.needsLocation}</button>
                  ) : null}
                  <button type="submit" disabled={counts.ready === 0 || counts.reading > 0 || isSaving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#e7a13d] px-4 py-3 text-sm font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
                    {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> {uploadProgress ? `Uploading ${uploadProgress.completed} of ${uploadProgress.total}` : "Uploading..."}</> : counts.reading > 0 ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading {counts.reading}</> : <><Upload className="h-4 w-4" /> Upload {counts.ready > 1 ? `${counts.ready} photos` : "photo"}</>}
                  </button>
                </>
              ) : null}
              {step === "place" ? (
                <>
                  <button type="button" onClick={goToReview} className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm font-bold text-stone-600 transition hover:bg-stone-50"><ArrowLeft className="h-4 w-4" /> Review</button>
                  <button type="submit" disabled={counts.ready === 0 || isSaving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#e7a13d] px-4 py-3 text-sm font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
                    {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> {uploadProgress ? `Uploading ${uploadProgress.completed} of ${uploadProgress.total}` : "Uploading..."}</> : <><Upload className="h-4 w-4" /> Upload {counts.ready > 1 ? `${counts.ready} photos` : "photo"}</>}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
