"use client";

import { Camera, CheckCircle2, Images, Loader2, MapPin, Minus, Plus, RotateCcw, Trash2, Upload, Video, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { PhotoUploadProgress } from "@/components/UploadPhotoPanel";
import { dayLabel, locationLabel, type QueueItem } from "@/lib/upload-queue";
import { cn } from "@/lib/utils";
import type { Day } from "@/types/trip";

// The one and only import surface: the map stays visible and interactive
// while the queue renders as a left sidebar (desktop) or bottom filmstrip
// (mobile), with a resizable corner preview of the active photo — the same
// corner-overlay idea as JourneyMiniMap. Captions, day assignment, adding
// and removing media all live here too; there is no separate review popup.
// Map taps and pin drags are handled by the parent panel; this component
// renders queue state and routes edits up.

// Corner preview sizes, stepped with +/- like JourneyMiniMap and remembered
// the same way. Index 1 is the default.
const PREVIEW_SIZES = [
  "w-44 md:w-56",
  "w-60 md:w-80",
  "w-[min(24rem,calc(100vw-1.5rem))] md:w-[28rem]",
  "w-[min(30rem,calc(100vw-1.5rem))] md:w-[38rem]",
];
const PREVIEW_SIZE_STORAGE_KEY = "lofoten-placement-preview-size";
const MEDIA_ACCEPT = "image/*,video/*,.heic,.heif,.mov,.m4v";

function storedSizeIndex() {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(PREVIEW_SIZE_STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < PREVIEW_SIZES.length ? parsed : 1;
}

type Props = {
  items: QueueItem[];
  days: Day[];
  mapAvailable: boolean;
  activeItemId: string | null;
  selectedIds: ReadonlySet<string>;
  isSaving: boolean;
  uploadProgress: PhotoUploadProgress | null;
  onSelectItem: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onSelectAllUnplaced: () => void;
  onClearSelection: () => void;
  onUpload: () => void;
  onClose: () => void;
  onAddFiles: (files: FileList | null) => void;
  onRemoveItem: (id: string) => void;
  onCaptionChange: (id: string, caption: string) => void;
  onDayChange: (id: string, dayId: string) => void;
  onAllDaysChange: (dayId: string) => void;
  onClearQueue: () => void;
};

function takenLabel(item: QueueItem) {
  if (!item.exif?.takenAt) return null;
  const parsed = new Date(item.exif.takenAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusDotClass(item: QueueItem) {
  if (item.status === "ready") return "bg-emerald-500";
  if (item.status === "needs-location") return "bg-amber-500";
  if (item.status === "invalid") return "bg-rose-500";
  return "bg-stone-300";
}

export function PlacementWorkspace({ items, days, mapAvailable, activeItemId, selectedIds, isSaving, uploadProgress, onSelectItem, onToggleSelected, onSelectAllUnplaced, onClearSelection, onUpload, onClose, onAddFiles, onRemoveItem, onCaptionChange, onDayChange, onAllDaysChange, onClearQueue }: Props) {
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

  function handleAddFiles(event: ChangeEvent<HTMLInputElement>) {
    onAddFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

  useEffect(() => {
    const urls = urlsRef.current;
    const alive = new Set<string>();
    for (const item of items) {
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

  const unplaced = items.filter((item) => item.status === "needs-location");
  const ready = items.filter((item) => item.status === "ready");
  const reading = items.filter((item) => item.status === "reading");
  const total = unplaced.length + ready.length + reading.length;
  const activeItem = items.find((item) => item.id === activeItemId) ?? null;
  const activeUrl = activeItem ? previewUrls.get(activeItem.id) ?? null : null;
  const allPlaced = total > 0 && unplaced.length === 0 && reading.length === 0;
  const placingSelection = selectedIds.size > 0;
  const activeEditable = activeItem !== null && activeItem.status !== "invalid";

  // Keyboard flow: arrows walk the queue, space adds the highlighted photo to
  // the group. Skipped while typing in a field; space is also left alone on
  // buttons so it keeps activating whatever is focused.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowLeft") {
        if (items.length === 0) return;
        event.preventDefault();
        const direction = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
        const currentIndex = items.findIndex((item) => item.id === activeItemId);
        const nextIndex = currentIndex === -1
          ? (direction === 1 ? 0 : items.length - 1)
          : (currentIndex + direction + items.length) % items.length;
        onSelectItem(items[nextIndex].id);
      } else if (mapAvailable && event.key === " " && tag !== "BUTTON" && activeItem && activeItem.status !== "invalid" && activeItem.status !== "reading") {
        event.preventDefault();
        onToggleSelected(activeItem.id);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, activeItemId, activeItem, mapAvailable, onSelectItem, onToggleSelected]);

  const hint = !mapAvailable
    ? unplaced.length > 0
      ? "The map is unavailable. Unplaced media is saved on this device and can be finished later."
      : "The map is unavailable, but media with locations can still be uploaded."
    : placingSelection
    ? `Tap the map once to place all ${selectedIds.size} selected`
    : reading.length > 0
      ? `Preparing ${reading.length} on your device...`
      : allPlaced
        ? "All photos are placed. Drag any pin to fine-tune."
        : "Tap the map to place the highlighted photo — it advances on its own.";

  const uploadButton = (
    <button
      type="button"
      onClick={onUpload}
      disabled={ready.length === 0 || reading.length > 0 || isSaving}
      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#e7a13d] px-4 py-2.5 text-sm font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isSaving
        ? <><Loader2 className="h-4 w-4 animate-spin" /> {uploadProgress ? `Uploading ${uploadProgress.completed} of ${uploadProgress.total}` : "Uploading..."}</>
        : reading.length > 0
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Reading {reading.length}</>
          : <><Upload className="h-4 w-4" /> Upload {ready.length > 1 ? `${ready.length} photos` : "photo"}</>}
    </button>
  );

  const selectionBar = !mapAvailable ? null : placingSelection ? (
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

  // Caption + day editor for the active photo; shared between the desktop
  // sidebar and the mobile bar.
  const activeEditor = activeItem ? (
    <div className="space-y-2">
      <div className={cn("rounded-md px-3 py-2 text-xs leading-5", activeItem.status === "ready" ? "bg-emerald-50 text-emerald-900" : activeItem.status === "needs-location" ? "bg-amber-50 text-amber-900" : activeItem.status === "invalid" ? "bg-rose-50 text-rose-900" : "bg-stone-100 text-stone-700")}>
        {activeItem.message}
      </div>
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={activeItem.caption}
          onChange={(event) => onCaptionChange(activeItem.id, event.target.value)}
          maxLength={280}
          disabled={!activeEditable}
          placeholder="Caption for this photo"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <select
          value={activeItem.dayId ?? ""}
          onChange={(event) => onDayChange(activeItem.id, event.target.value)}
          disabled={!activeEditable}
          className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm text-stone-900 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Day for this photo"
        >
          <option value="">All days</option>
          {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
        </select>
        <button type="button" onClick={() => onRemoveItem(activeItem.id)} disabled={isSaving} className="rounded-lg border border-stone-300 bg-white px-2.5 text-stone-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-45" aria-label={`Remove ${activeItem.file.name}`}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {/* Corner photo preview — large enough to actually recognize the spot. */}
      {activeItem ? (
        <div className={cn("pointer-events-auto absolute right-3 bottom-[14.5rem] overflow-hidden rounded-2xl border border-stone-200/80 bg-[rgba(255,253,246,0.98)] shadow-[0_20px_60px_rgba(46,61,54,0.3)] backdrop-blur transition-all md:bottom-6 md:right-14", PREVIEW_SIZES[previewSizeIndex])}>
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
            <h2 className="font-serif text-xl font-semibold tracking-tight text-stone-950">Add photos</h2>
            <button type="button" onClick={onClose} className="-mr-1 rounded-full p-2 text-stone-500 hover:bg-stone-900/5" aria-label="Close upload"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.1em] text-stone-500">
            <span>{ready.length} of {total} placed</span>
            <span className="text-teal-800">{unplaced.length} to go</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full rounded-full bg-teal-700 transition-all" style={{ width: total > 0 ? `${Math.round((ready.length / total) * 100)}%` : "0%" }} />
          </div>
          <p className="mt-2 text-xs leading-5 text-stone-600">{hint}</p>
          <p className="mt-1 text-[11px] text-stone-400">Arrow keys move through photos · space adds to the group</p>
        </div>
        {activeEditor ? <div className="border-b border-stone-200/70 px-3 py-2.5">{activeEditor}</div> : null}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
          {items.map((item) => (
            <div key={item.id} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 transition", activeItemId === item.id ? "bg-teal-50 ring-1 ring-teal-700/30" : "hover:bg-stone-100")}>
              <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => onToggleSelected(item.id)} disabled={!mapAvailable || item.status === "invalid" || item.status === "reading"} className="h-4 w-4 shrink-0 accent-teal-700 disabled:opacity-30" aria-label={`Select ${item.file.name} for group placement`} />
              <button type="button" onClick={() => onSelectItem(item.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-stone-100">
                  {previewUrls.get(item.id) ? (
                    item.mediaType === "video"
                      ? <video src={previewUrls.get(item.id)} muted playsInline className="h-full w-full object-cover" />
                      // eslint-disable-next-line @next/next/no-img-element -- Object URLs from local files cannot be optimized by next/image.
                      : <img src={previewUrls.get(item.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-xs font-bold", item.status === "invalid" ? "text-rose-800" : "text-stone-900")}>{item.file.name}</span>
                  <span className="block truncate text-[11px] text-stone-500">{item.status === "invalid" ? item.message : [takenLabel(item), dayLabel(days, item.dayId)].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", statusDotClass(item))} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-stone-200/70 p-3">
          {selectionBar}
          <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-xs font-semibold text-stone-600">
            <span>Set day for all</span>
            <select value="" onChange={(event) => { if (event.target.value !== "__idle") onAllDaysChange(event.target.value === "__all" ? "" : event.target.value); }} className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
              <option value="" disabled>Choose day...</option>
              <option value="__all">All days</option>
              {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2.5 text-xs font-bold text-stone-600 transition hover:bg-stone-50">
              <Images className="h-4 w-4" /> Add more
              <input type="file" accept={MEDIA_ACCEPT} multiple className="hidden" onChange={handleAddFiles} />
            </label>
            <button type="button" onClick={onClearQueue} disabled={isSaving} className="rounded-lg border border-stone-300 bg-white px-2.5 py-2.5 text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45" aria-label="Clear queue" title="Clear queue"><RotateCcw className="h-4 w-4" /></button>
            {allPlaced ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="All placed" /> : null}
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
              <button type="button" onClick={onUpload} disabled={isSaving || reading.length > 0} className="flex items-center gap-1 rounded-lg bg-[#e7a13d] px-2.5 py-1.5 text-xs font-black text-stone-950 transition hover:bg-[#f0ae4b] disabled:cursor-not-allowed disabled:opacity-50">
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {uploadProgress ? `${uploadProgress.completed}/${uploadProgress.total}` : ready.length}
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="rounded-lg border border-stone-300 bg-white p-1.5 text-stone-600 transition hover:bg-stone-50" aria-label="Close upload"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <p className="mt-1 truncate text-[11px] text-stone-500">{hint}</p>
        <div ref={filmstripRef} className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {items.map((item) => (
            <div key={item.id} data-thumb-id={item.id} className="relative shrink-0">
              <button type="button" onClick={() => onSelectItem(item.id)} className={cn("block h-16 w-16 overflow-hidden rounded-lg bg-stone-100 transition", activeItemId === item.id ? "ring-2 ring-teal-700" : "ring-1 ring-stone-200")} aria-label={`Select ${item.file.name}`}>
                {previewUrls.get(item.id) ? (
                  item.mediaType === "video"
                    ? <video src={previewUrls.get(item.id)} muted playsInline className="h-full w-full object-cover" />
                    // eslint-disable-next-line @next/next/no-img-element -- Object URLs from local files cannot be optimized by next/image.
                    : <img src={previewUrls.get(item.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : <span className="flex h-full items-center justify-center text-stone-400"><Camera className="h-4 w-4" /></span>}
              </button>
              {mapAvailable && item.status !== "invalid" && item.status !== "reading" ? (
                <button type="button" onClick={() => onToggleSelected(item.id)} className={cn("absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-black transition", selectedIds.has(item.id) ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white/90 text-transparent")} aria-label={`${selectedIds.has(item.id) ? "Deselect" : "Select"} ${item.file.name} for group placement`} aria-pressed={selectedIds.has(item.id)}>
                  ✓
                </button>
              ) : null}
              <span className={cn("absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full ring-1 ring-white", statusDotClass(item))} aria-hidden />
            </div>
          ))}
          <label className="flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white text-stone-500 transition hover:bg-stone-50" aria-label="Add more media">
            <Images className="h-5 w-5" />
            <input type="file" accept={MEDIA_ACCEPT} multiple className="hidden" onChange={handleAddFiles} />
          </label>
        </div>
        {selectionBar ? <div className="mt-2">{selectionBar}</div> : null}
        {activeEditor ? <div className="mt-2">{activeEditor}</div> : null}
      </div>
    </div>
  );
}
