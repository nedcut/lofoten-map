"use client";

import { ArrowLeft, Camera, CheckCircle2, Loader2, MapPin, Minus, Plus, Upload, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PhotoUploadProgress } from "@/components/UploadPhotoPanel";
import { dayLabel, locationLabel, type QueueItem } from "@/lib/upload-queue";
import { cn } from "@/lib/utils";
import type { Day } from "@/types/trip";

// Full-time placement workspace: the map stays visible and interactive while
// the queue renders as a left sidebar (desktop) or bottom filmstrip (mobile),
// with a large corner preview of the active photo — same corner-overlay idea
// as JourneyMiniMap. Map taps and pin drags are handled by the parent panel;
// this component only renders queue state and routes selection events up.

// Corner preview sizes, stepped with +/- like JourneyMiniMap and remembered
// the same way. Index 1 is the default.
const PREVIEW_SIZES = [
  "w-44 md:w-56",
  "w-60 md:w-80",
  "w-[min(24rem,calc(100vw-1.5rem))] md:w-[28rem]",
  "w-[min(30rem,calc(100vw-1.5rem))] md:w-[38rem]",
];
const PREVIEW_SIZE_STORAGE_KEY = "lofoten-placement-preview-size";

function storedSizeIndex() {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(PREVIEW_SIZE_STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < PREVIEW_SIZES.length ? parsed : 1;
}

type Props = {
  items: QueueItem[];
  days: Day[];
  activeItemId: string | null;
  selectedIds: ReadonlySet<string>;
  isSaving: boolean;
  uploadProgress: PhotoUploadProgress | null;
  onSelectItem: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onSelectAllUnplaced: () => void;
  onClearSelection: () => void;
  onDone: () => void;
  onUpload: () => void;
};

function takenLabel(item: QueueItem) {
  if (!item.exif?.takenAt) return null;
  const parsed = new Date(item.exif.takenAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatusDot({ item }: { item: QueueItem }) {
  return <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", item.status === "ready" ? "bg-emerald-500" : item.status === "needs-location" ? "bg-amber-500" : "bg-stone-300")} aria-hidden />;
}

export function PlacementWorkspace({ items, days, activeItemId, selectedIds, isSaving, uploadProgress, onSelectItem, onToggleSelected, onSelectAllUnplaced, onClearSelection, onDone, onUpload }: Props) {
  // One object URL per queue item so the filmstrip and preview can render the
  // local files. URLs are created once per item and revoked when the item
  // leaves the queue or the workspace unmounts.
  const [previewUrls, setPreviewUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const urlsRef = useRef(new Map<string, string>());
  const [previewSizeIndex, setPreviewSizeIndex] = useState(storedSizeIndex);
  const filmstripRef = useRef<HTMLDivElement | null>(null);

  function stepPreviewSize(direction: 1 | -1) {
    setPreviewSizeIndex((current) => {
      const next = Math.min(PREVIEW_SIZES.length - 1, Math.max(0, current + direction));
      if (typeof window !== "undefined") window.localStorage.setItem(PREVIEW_SIZE_STORAGE_KEY, String(next));
      return next;
    });
  }

  useEffect(() => {
    const urls = urlsRef.current;
    const alive = new Set<string>();
    for (const item of items) {
      if (item.status === "invalid") continue;
      alive.add(item.id);
      if (!urls.has(item.id)) urls.set(item.id, URL.createObjectURL(item.file));
    }
    for (const [id, url] of urls) {
      if (alive.has(id)) continue;
      URL.revokeObjectURL(url);
      urls.delete(id);
    }
    setPreviewUrls(new Map(urls));
  }, [items]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // Keep the active thumbnail visible as auto-advance walks the filmstrip.
  useEffect(() => {
    if (!activeItemId) return;
    filmstripRef.current?.querySelector(`[data-thumb-id="${CSS.escape(activeItemId)}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeItemId]);

  const placeable = items.filter((item) => item.status !== "invalid");
  const unplaced = placeable.filter((item) => item.status === "needs-location");
  const ready = placeable.filter((item) => item.status === "ready");
  const total = unplaced.length + ready.length;
  const activeItem = placeable.find((item) => item.id === activeItemId) ?? null;
  const activeUrl = activeItem ? previewUrls.get(activeItem.id) ?? null : null;
  const allPlaced = total > 0 && unplaced.length === 0;
  const placingSelection = selectedIds.size > 0;

  // Keyboard flow: arrows walk the queue, space adds the highlighted photo to
  // the group. Skipped while typing in a field; space is also left alone on
  // buttons so it keeps activating whatever is focused.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
        if (placeable.length === 0) return;
        event.preventDefault();
        const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
        const currentIndex = placeable.findIndex((item) => item.id === activeItemId);
        const nextIndex = currentIndex === -1
          ? (direction === 1 ? 0 : placeable.length - 1)
          : (currentIndex + direction + placeable.length) % placeable.length;
        onSelectItem(placeable[nextIndex].id);
      } else if (event.key === " " && tag !== "BUTTON" && activeItemId) {
        event.preventDefault();
        onToggleSelected(activeItemId);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [placeable, activeItemId, onSelectItem, onToggleSelected]);

  const hint = placingSelection
    ? `Tap the map once to place all ${selectedIds.size} selected`
    : allPlaced
      ? "All photos are placed. Drag any pin to fine-tune."
      : "Tap the map to place the highlighted photo — it advances on its own.";

  const uploadButton = (
    <button
      type="button"
      onClick={onUpload}
      disabled={ready.length === 0 || isSaving}
      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#e7a13d] px-4 py-2.5 text-sm font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isSaving
        ? <><Loader2 className="h-4 w-4 animate-spin" /> {uploadProgress ? `Uploading ${uploadProgress.completed} of ${uploadProgress.total}` : "Uploading..."}</>
        : <><Upload className="h-4 w-4" /> Upload {ready.length > 1 ? `${ready.length} photos` : "photo"}</>}
    </button>
  );

  const selectionBar = placingSelection ? (
    <div className="flex items-center gap-2 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-2 text-xs font-bold text-teal-950">
      <MapPin className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">Next tap places {selectedIds.size} photo{selectedIds.size === 1 ? "" : "s"}</span>
      <button type="button" onClick={onClearSelection} className="rounded-md px-2 py-1 text-stone-500 transition hover:bg-stone-100">Clear</button>
    </div>
  ) : unplaced.length > 1 ? (
    <button type="button" onClick={onSelectAllUnplaced} className="w-full rounded-lg border border-dashed border-teal-700/35 bg-teal-50/50 px-3 py-2 text-xs font-bold text-teal-900 transition hover:bg-teal-50">
      Select all {unplaced.length} unplaced · place with one tap
    </button>
  ) : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {/* Corner photo preview — large enough to actually recognize the spot. */}
      {activeItem ? (
        <div className={cn("pointer-events-auto absolute right-3 bottom-[11.5rem] overflow-hidden rounded-2xl border border-stone-200/80 bg-[rgba(255,253,246,0.98)] shadow-[0_20px_60px_rgba(46,61,54,0.3)] backdrop-blur transition-all md:bottom-6 md:right-14", PREVIEW_SIZES[previewSizeIndex])}>
          <div className="relative aspect-[4/3] bg-stone-100">
            {activeUrl ? (
              activeItem.mediaType === "video"
                ? <video src={activeUrl} muted playsInline className="h-full w-full object-cover" />
                // eslint-disable-next-line @next/next/no-img-element -- Object URLs from local files cannot be optimized by next/image.
                : <img src={activeUrl} alt="" className="h-full w-full object-cover" />
            ) : <div className="flex h-full items-center justify-center text-stone-400"><Camera className="h-6 w-6" /></div>}
            <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
              <button type="button" onClick={() => stepPreviewSize(-1)} disabled={previewSizeIndex === 0} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-950/55 text-white backdrop-blur transition hover:bg-stone-950/75 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Shrink photo preview" title="Smaller preview">
                <Minus className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => stepPreviewSize(1)} disabled={previewSizeIndex === PREVIEW_SIZES.length - 1} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-950/55 text-white backdrop-blur transition hover:bg-stone-950/75 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Grow photo preview" title="Larger preview">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="px-3 py-2">
            <div className="flex items-center gap-1.5 truncate text-xs font-bold text-stone-950">{activeItem.mediaType === "video" ? <Video className="h-3.5 w-3.5 shrink-0" /> : null}{activeItem.file.name}</div>
            <div className="mt-0.5 truncate text-[11px] text-stone-500">{[takenLabel(activeItem), dayLabel(days, activeItem.dayId), locationLabel(activeItem)].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      ) : null}

      {/* Desktop: the queue takes over the day-sidebar column; map stays live. */}
      <div className="pointer-events-auto absolute bottom-4 left-4 top-[4.5rem] hidden w-96 flex-col overflow-hidden rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.97)] shadow-[0_30px_90px_rgba(46,61,54,0.32)] backdrop-blur md:flex">
        <div className="border-b border-stone-200/70 px-4 py-3.5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-serif text-xl font-semibold tracking-tight text-stone-950">Place on map</h2>
            <button type="button" onClick={onDone} className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-bold text-stone-600 transition hover:bg-stone-50"><ArrowLeft className="h-3.5 w-3.5" /> Review</button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.1em] text-stone-500">
            <span>{ready.length} of {total} placed</span>
            <span className="text-teal-800">{unplaced.length} to go</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full rounded-full bg-teal-700 transition-all" style={{ width: total > 0 ? `${Math.round((ready.length / total) * 100)}%` : "0%" }} />
          </div>
          <p className="mt-2 text-xs leading-5 text-stone-600">{hint}</p>
          <p className="mt-1 text-[11px] text-stone-400">Arrow keys move through photos · space adds to the group</p>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
          {placeable.map((item) => (
            <div key={item.id} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 transition", activeItemId === item.id ? "bg-teal-50 ring-1 ring-teal-700/30" : "hover:bg-stone-100")}>
              <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => onToggleSelected(item.id)} className="h-4 w-4 shrink-0 accent-teal-700" aria-label={`Select ${item.file.name} for group placement`} />
              <button type="button" onClick={() => onSelectItem(item.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-stone-100">
                  {previewUrls.get(item.id) ? (
                    item.mediaType === "video"
                      ? <video src={previewUrls.get(item.id)} muted playsInline className="h-full w-full object-cover" />
                      // eslint-disable-next-line @next/next/no-img-element -- Object URLs from local files cannot be optimized by next/image.
                      : <img src={previewUrls.get(item.id)} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-stone-900">{item.file.name}</span>
                  <span className="block truncate text-[11px] text-stone-500">{[takenLabel(item), dayLabel(days, item.dayId)].filter(Boolean).join(" · ")}</span>
                </span>
                <StatusDot item={item} />
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-stone-200/70 p-3">
          {selectionBar}
          <div className="flex items-center gap-2">
            {allPlaced ? <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> All placed</span> : null}
            {uploadButton}
          </div>
        </div>
      </div>

      {/* Mobile: bottom filmstrip; thumbnails are the queue. */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-teal-700/30 bg-[rgba(255,253,246,0.98)] px-3 pb-[calc(env(safe-area-inset-bottom)+0.6rem)] pt-2.5 shadow-[0_-12px_40px_rgba(46,61,54,0.25)] backdrop-blur-xl md:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.1em] text-teal-800">
            <MapPin className="h-3.5 w-3.5" /> {ready.length}/{total} placed
          </div>
          <div className="flex items-center gap-1.5">
            {ready.length > 0 ? (
              <button type="button" onClick={onUpload} disabled={isSaving} className="flex items-center gap-1 rounded-lg bg-[#e7a13d] px-2.5 py-1.5 text-xs font-black text-stone-950 transition hover:bg-[#f0ae4b] disabled:cursor-not-allowed disabled:opacity-50">
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploadProgress ? `${uploadProgress.completed}/${uploadProgress.total}` : ready.length}
              </button>
            ) : null}
            <button type="button" onClick={onDone} className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-bold text-stone-700 transition hover:bg-stone-50">Review</button>
          </div>
        </div>
        <p className="mt-1 truncate text-[11px] text-stone-500">{hint}</p>
        <div ref={filmstripRef} className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {placeable.map((item) => (
            <div key={item.id} data-thumb-id={item.id} className="relative shrink-0">
              <button type="button" onClick={() => onSelectItem(item.id)} className={cn("block h-16 w-16 overflow-hidden rounded-lg bg-stone-100 transition", activeItemId === item.id ? "ring-2 ring-teal-700" : "ring-1 ring-stone-200")} aria-label={`Place ${item.file.name}`}>
                {previewUrls.get(item.id) ? (
                  item.mediaType === "video"
                    ? <video src={previewUrls.get(item.id)} muted playsInline className="h-full w-full object-cover" />
                    // eslint-disable-next-line @next/next/no-img-element -- Object URLs from local files cannot be optimized by next/image.
                    : <img src={previewUrls.get(item.id)} alt="" className="h-full w-full object-cover" />
                ) : <span className="flex h-full items-center justify-center text-stone-400"><Camera className="h-4 w-4" /></span>}
              </button>
              <button type="button" onClick={() => onToggleSelected(item.id)} className={cn("absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-black transition", selectedIds.has(item.id) ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white/90 text-transparent")} aria-label={`${selectedIds.has(item.id) ? "Deselect" : "Select"} ${item.file.name} for group placement`} aria-pressed={selectedIds.has(item.id)}>
                ✓
              </button>
              <span className={cn("absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full ring-1 ring-white", item.status === "ready" ? "bg-emerald-500" : item.status === "needs-location" ? "bg-amber-500" : "bg-stone-300")} aria-hidden />
            </div>
          ))}
        </div>
        {selectionBar ? <div className="mt-2">{selectionBar}</div> : null}
      </div>
    </div>
  );
}
