"use client";

import { FileImage, Images, RotateCcw, Trash2, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { PlacementWorkspace } from "@/components/PlacementWorkspace";
import { mapWithConcurrency } from "@/lib/concurrency";
import { extractPhotoExif, type ExtractedExif } from "@/lib/exif";
import { fileContentHash } from "@/lib/file-hash";
import { detectMediaType } from "@/lib/media-processing";
import { clearPhotoDraft, readPhotoDraft, writePhotoDraft, type PhotoDraft } from "@/lib/photo-draft-store";
import { collectTimeAnchors, timeInterpolateItems } from "@/lib/photo-interpolate";
import {
  coordinateKey,
  findDayIdForCoordinate,
  findDayIdForExifDate,
  formatBytes,
  mediaLabel,
  nextPlacementTarget,
  routePlaceNoGpsItems,
  routePlaceQueueItems,
  type QueueItem,
} from "@/lib/upload-queue";
import type { Day, LngLat, Photo, RouteSegment } from "@/types/trip";

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
  // Photos already on the trip; their GPS+timestamp pairs anchor the
  // time-interpolation of GPS-less photos in a new batch.
  existingPhotos: Photo[];
  // Keys the offline draft of the import queue in IndexedDB.
  tripSlug: string;
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

// The import flow has exactly one surface: the OS file picker opens as soon
// as the panel mounts, and a selected batch lands directly in the placement
// workspace over the live map. A small picker card exists only as a fallback
// for a cancelled dialog (where supported we just close instead), a browser
// that blocks the programmatic open, or an unfinished draft to restore.
export function UploadPhotoPanel({ days, routes, existingPhotos, tripSlug, defaultDayId, pendingCoordinate, isSaving, onCancel, onCoordinatePreview, onSave }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<PhotoUploadProgress | null>(null);
  // Checkbox/filmstrip selection for placing several photos with a single map tap.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // The map-tap effect must depend only on pendingCoordinate, so the queue,
  // active photo, and selection it acts on are read through refs.
  const itemsRef = useRef(items);
  const activeItemIdRef = useRef(activeItemId);
  const selectedIdsRef = useRef(selectedIds);
  const previewCoordinateKeyRef = useRef<string | null>(null);
  // A queue saved by a previous session (tab closed or crashed mid-import),
  // offered for restore while the current queue is still empty.
  const [restorableDraft, setRestorableDraft] = useState<PhotoDraft | null>(null);
  const restorableDraftRef = useRef(restorableDraft);
  const hadItemsRef = useRef(false);
  const draftTimerRef = useRef<number | null>(null);
  const cameraRollInputRef = useRef<HTMLInputElement | null>(null);
  const autoPickedRef = useRef(false);

  // The single draft read for this mount; the picker-cancel handler awaits the
  // same promise so both always agree on whether a draft exists.
  const draftReadRef = useRef<Promise<PhotoDraft | null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = readPhotoDraft(tripSlug).then((draft) => (draft && draft.items.length > 0 ? draft : null));
    draftReadRef.current = read;
    void read.then((draft) => {
      if (!cancelled && draft) setRestorableDraft(draft);
    });
    return () => {
      cancelled = true;
    };
  }, [tripSlug]);

  useEffect(() => {
    restorableDraftRef.current = restorableDraft;
  }, [restorableDraft]);

  // Open the OS file picker immediately. Dismissing it with nothing queued
  // closes the panel outright (the "cancel" event is supported in current
  // Chrome/Safari/Firefox) — unless a draft is waiting, in which case the
  // fallback card stays up to offer the restore. Cancel can fire before the
  // mount-time draft read resolves, so the handler awaits that same read.
  useEffect(() => {
    const input = cameraRollInputRef.current;
    if (!input) return;
    const handlePickerCancel = () => {
      void (draftReadRef.current ?? Promise.resolve(null)).then((draft) => {
        const hasDraft = restorableDraftRef.current !== null || draft !== null;
        if (itemsRef.current.length === 0 && !hasDraft) onCancel();
      });
    };
    input.addEventListener("cancel", handlePickerCancel);
    if (!autoPickedRef.current) {
      autoPickedRef.current = true;
      input.click();
    }
    return () => input.removeEventListener("cancel", handlePickerCancel);
  }, [onCancel]);

  // Persist the analyzed queue (debounced) so a crash or reload mid-import
  // does not lose the selected batch. Skips the initial empty state so an
  // unopened panel never clears a restorable draft.
  useEffect(() => {
    if (items.length > 0) hadItemsRef.current = true;
    if (!hadItemsRef.current) return;
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      const persistable = items.filter((item) => item.status === "ready" || item.status === "needs-location");
      if (persistable.length === 0) void clearPhotoDraft(tripSlug);
      else void writePhotoDraft(tripSlug, persistable);
    }, 800);
    return () => {
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [items, tripSlug]);

  function restoreDraft() {
    if (!restorableDraft) return;
    setItems(restorableDraft.items);
    setActiveItemId(nextPlacementTarget(restorableDraft.items, new Set()) ?? restorableDraft.items[0]?.id ?? null);
    setRestorableDraft(null);
  }

  function discardDraft() {
    setRestorableDraft(null);
    void clearPhotoDraft(tripSlug);
  }

  const activeItem = (activeItemId ? items.find((item) => item.id === activeItemId) : null) ?? items[0] ?? null;

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

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  // Drop selections that no longer exist in the queue (removed or cleared).
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const alive = new Set(Array.from(current).filter((id) => items.some((item) => item.id === id)));
      return alive.size === current.size ? current : alive;
    });
  }, [items]);

  // A genuine map tap (key differs from our echo) assigns the location to the
  // active photo. This must depend ONLY on pendingCoordinate — if it also reacted
  // to activeItemId, simply selecting a photo would write a stale pending pin onto
  // it, flipping it to "ready" and making it vanish from the needs-location list.
  useEffect(() => {
    if (!pendingCoordinate) return;
    const nextKey = coordinateKey(pendingCoordinate);
    if (previewCoordinateKeyRef.current === nextKey) {
      previewCoordinateKeyRef.current = null;
      return;
    }
    // A selection means one tap places the whole group; otherwise the tap
    // places (or nudges) just the active photo.
    const current = itemsRef.current;
    const placeableIds = new Set(current.filter((item) => item.status !== "invalid" && item.status !== "reading").map((item) => item.id));
    const selected = Array.from(selectedIdsRef.current).filter((id) => placeableIds.has(id));
    const targetIds = new Set(selected.length > 0 ? selected : [activeItemIdRef.current].filter((id): id is string => id !== null && placeableIds.has(id)));
    if (targetIds.size === 0) return;
    // Nudging an already-placed photo should not advance; placing one should.
    const placedSomethingNew = current.some((item) => targetIds.has(item.id) && item.status === "needs-location");
    const updated = current.map((item) => targetIds.has(item.id) && placeableIds.has(item.id)
      ? { ...item, coordinate: pendingCoordinate, locationSource: "manual" as const, status: "ready" as const, message: "Location set from the map." }
      : item);
    setItems(updated);
    if (selected.length > 0) setSelectedIds(new Set());
    if (placedSomethingNew) {
      const nextId = nextPlacementTarget(updated, targetIds);
      if (nextId) setActiveItemId(nextId);
    }
  }, [pendingCoordinate]);

  // Keep the active selection valid as the queue changes.
  useEffect(() => {
    if (items.length === 0) {
      if (activeItemId !== null) setActiveItemId(null);
      return;
    }
    if (activeItemId && items.some((item) => item.id === activeItemId)) return;
    setActiveItemId(items[0].id);
  }, [activeItemId, items]);

  async function handleFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;
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

    // The workspace shows the batch the moment it lands; analysis fills in below.
    setItems((current) => [...current, ...nextItems]);
    setActiveItemId((current) => current ?? nextItems[0]?.id ?? null);

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

    const rawAnalyzed = fingerprinted.map((item, order) => {
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
    });
    // Time-interpolation runs before the route fallback: a position derived
    // from real GPS anchors beats an even spread along the day's route.
    const anchors = collectTimeAnchors(rawAnalyzed, existingPhotos);
    const interpolated = timeInterpolateItems(rawAnalyzed, anchors);
    for (const item of interpolated) {
      if (item.dayId || item.locationSource !== "time" || !item.coordinate) continue;
      const routeDayId = findDayIdForCoordinate(routes, item.coordinate);
      if (routeDayId) {
        item.dayId = routeDayId;
        item.dayMatchSource = "route";
      }
    }
    const analyzed = routePlaceNoGpsItems(interpolated, routes);
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

    // Focus the first photo needing a pin (taken-time order); with everything
    // auto-placed, focus the first of the batch for review.
    const focusId = nextPlacementTarget(analyzed, new Set()) ?? analyzed[0]?.id ?? null;
    if (focusId) setActiveItemId(focusId);
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
    if (!result || result.savedClientIds.length === 0) return;
    if (result.failedClientIds.length === 0) {
      // Everything saved; the parent is about to close the panel, so clear
      // the draft now rather than relying on the debounced persist.
      void clearPhotoDraft(tripSlug);
      return;
    }
    const savedIds = new Set(result.savedClientIds);
    setItems((current) => current.filter((item) => !savedIds.has(item.id)));
    setActiveItemId(result.failedClientIds[0] ?? null);
  }

  function setItemCaption(itemId: string, caption: string) {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, caption } : item));
  }

  function setItemDay(itemId: string, nextDayId: string) {
    setItems((current) => routePlaceQueueItems(current.map((item) => {
      if (item.id !== itemId) return item;
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

  function setAllDays(nextDayId: string) {
    const dayId = nextDayId || null;
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
    setActiveItemId(null);
    setSelectedIds(new Set());
    onCoordinatePreview(null);
  }

  function toggleSelected(itemId: string) {
    // Selecting a photo also focuses it, so the corner preview shows what
    // was just added to the group.
    if (!selectedIds.has(itemId)) setActiveItemId(itemId);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  if (items.length > 0) {
    return (
      <PlacementWorkspace
        items={items}
        days={days}
        activeItemId={activeItem?.id ?? null}
        selectedIds={selectedIds}
        isSaving={isSaving}
        uploadProgress={uploadProgress}
        onSelectItem={setActiveItemId}
        onToggleSelected={toggleSelected}
        onSelectAllUnplaced={() => setSelectedIds(new Set(items.filter((item) => item.status === "needs-location").map((item) => item.id)))}
        onClearSelection={() => setSelectedIds(new Set())}
        onUpload={() => void submit()}
        onClose={onCancel}
        onAddFiles={handleFiles}
        onRemoveItem={removeItem}
        onCaptionChange={setItemCaption}
        onDayChange={setItemDay}
        onAllDaysChange={setAllDays}
        onClearQueue={clearQueue}
      />
    );
  }

  // -------- Fallback picker card (cancelled dialog or restorable draft) --------
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-[1.6rem] border border-stone-200/80 bg-[rgba(255,253,246,0.99)] p-5 shadow-[0_30px_90px_rgba(46,61,54,0.32)]">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-serif text-2xl font-semibold tracking-tight text-stone-950">Add photos & videos</h2>
          <button onClick={onCancel} className="-mr-1 rounded-full p-2 text-stone-500 hover:bg-stone-900/5" aria-label="Close upload"><X className="h-5 w-5" /></button>
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-600">GPS, dates, and placement are prepared on your device before anything uploads.</p>
        {restorableDraft ? (
          <div className="mt-4 space-y-2 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950">
            <div className="font-bold">Unfinished import found</div>
            <p className="text-xs leading-5 text-amber-900/80">{restorableDraft.items.length} media item{restorableDraft.items.length === 1 ? "" : "s"} from a previous session never finished uploading.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={restoreDraft} className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.98]">
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
              <button type="button" onClick={discardDraft} className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold text-stone-600 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.98]">
                <Trash2 className="h-3.5 w-3.5" /> Discard
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-4 grid gap-3">
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-teal-700/35 bg-teal-50 px-4 py-5 text-center text-teal-950 transition hover:bg-teal-100">
            <Images className="h-7 w-7" />
            <span className="text-base font-black">Choose from camera roll</span>
            <span className="text-xs text-teal-900/70">iPhone, Android, HEIC, JPG, MOV, MP4</span>
            <input ref={cameraRollInputRef} name="media" type="file" accept="image/*,video/*,.heic,.heif,.mov,.m4v" multiple className="hidden" onChange={handleFileInputChange} />
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-700 transition hover:bg-stone-50">
            <FileImage className="h-4 w-4" /> Browse exported camera files
            <input type="file" accept="image/*,video/*,.heic,.heif,.mov,.m4v" multiple className="hidden" onChange={handleFileInputChange} />
          </label>
        </div>
      </div>
    </div>
  );
}
