"use client";

import { ChevronLeft, ChevronRight, CirclePause, CirclePlay, Gauge, Link, Loader2, MapPinned, Pencil, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { JourneyMiniMap } from "@/components/JourneyMiniMap";
import { friendlyPersonName } from "@/lib/display-name";
import { formatDateOnly, formatDateTime } from "@/lib/utils";
import { journeyItemTitle, type JourneyAttachedItem, type JourneyItem } from "@/lib/journey";
import type { Day, Photo, RouteSegment } from "@/types/trip";

export type JourneyFilter = "all" | "photos" | "journal";

type PhotoUpdate = {
  day_id: string | null;
  uploader_name: string | null;
  caption: string | null;
  lat: number | null;
  lng: number | null;
  taken_at: string | null;
};

type Props = {
  items: JourneyItem[];
  allItems: JourneyItem[];
  activeIndex: number;
  days: Day[];
  routes: RouteSegment[];
  filter: JourneyFilter;
  uploaderFilter: string;
  currentUserId: string | null;
  isAdmin: boolean;
  isSaving: boolean;
  onFilterChange: (filter: JourneyFilter) => void;
  onUploaderFilterChange: (uploader: string) => void;
  onSelectIndex: (index: number) => void;
  onSelectItem: (id: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  onUpdatePhoto: (photoId: string, input: PhotoUpdate) => Promise<void>;
  onEditPhoto: (photoId: string) => void;
};

function itemDate(item: JourneyItem) {
  if (item.kind === "photo") return item.primary.taken_at || item.primary.created_at;
  return item.primary.created_at;
}

function dayLabel(days: Day[], dayId: string | null) {
  if (!dayId) return "Unsorted";
  const day = days.find((entry) => entry.id === dayId);
  if (!day) return "Unsorted";
  return `Day ${day.day_number}${day.title ? `: ${day.title}` : ""}`;
}

function itemKindLabel(item: JourneyItem) {
  if (item.kind === "photo") return item.primary.media_type === "video" ? "Video" : "Photo";
  if (item.kind === "note") return "Note";
  return item.primary.place_type || "Place";
}

function photoCanEdit(photo: Photo, currentUserId: string | null, isAdmin: boolean) {
  return isAdmin || Boolean(currentUserId && photo.user_id === currentUserId);
}

function photoUpdateWithCaption(photo: Photo, caption: string | null): PhotoUpdate {
  return {
    day_id: photo.day_id,
    uploader_name: photo.uploader_name,
    caption,
    lat: photo.lat,
    lng: photo.lng,
    taken_at: photo.taken_at,
  };
}

function attachedText(attached: JourneyAttachedItem) {
  if (attached.kind === "note") return attached.item.body;
  return [attached.item.name, attached.item.description].filter(Boolean).join(" · ");
}

export function JourneyPlayback({
  items,
  allItems,
  activeIndex,
  days,
  routes,
  filter,
  uploaderFilter,
  currentUserId,
  isAdmin,
  isSaving,
  onFilterChange,
  onUploaderFilterChange,
  onSelectIndex,
  onSelectItem,
  onNext,
  onPrev,
  onClose,
  onUpdatePhoto,
  onEditPhoto,
}: Props) {
  const activeItem = items[activeIndex] ?? items[0];
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [interactionHold, setInteractionHold] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [editingCaption, setEditingCaption] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const autoplayTimerRef = useRef<number | null>(null);
  const videoFallbackTimerRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const activeIndexRef = useRef(activeIndex);
  const uploaders = useMemo(() => {
    const values = allItems.flatMap((item) => item.kind === "photo" && item.primary.uploader_name ? [item.primary.uploader_name] : []);
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [allItems]);

  useEffect(() => {
    if (!activeItem || activeItem.kind !== "photo") {
      setCaptionDraft("");
      setEditingCaption(false);
      return;
    }
    setCaptionDraft(activeItem.primary.caption ?? "");
    setEditingCaption(false);
  }, [activeItem]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
      if (autoplayTimerRef.current) window.clearTimeout(autoplayTimerRef.current);
      if (videoFallbackTimerRef.current) window.clearTimeout(videoFallbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (videoFallbackTimerRef.current) window.clearTimeout(videoFallbackTimerRef.current);
  }, [activeIndex]);

  function advanceVideoInSlideshow() {
    if (!isPlayingRef.current) return;
    if (activeIndexRef.current >= items.length - 1) setIsPlaying(false);
    else onNext();
  }

  function scheduleVideoAdvance(durationMs: number) {
    if (videoFallbackTimerRef.current) window.clearTimeout(videoFallbackTimerRef.current);
    videoFallbackTimerRef.current = window.setTimeout(() => {
      videoFallbackTimerRef.current = null;
      advanceVideoInSlideshow();
    }, Math.max(durationMs, 3000));
  }

  function noteInteraction() {
    setInteractionHold(true);
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => setInteractionHold(false), 3000);
  }

  useEffect(() => {
    if (!isPlaying || interactionHold || !activeItem || items.length < 2 || (activeItem.kind === "photo" && activeItem.primary.media_type === "video")) return;
    const baseDuration = activeItem.kind === "photo" && !activeItem.primary.caption ? 5000 : 7000;
    const duration = baseDuration / speed;
    const isLast = activeIndex >= items.length - 1;
    autoplayTimerRef.current = window.setTimeout(() => {
      // Autoplay runs through the journey once and then pauses on the final
      // item; manual prev/next still wraps for convenience.
      if (isLast) setIsPlaying(false);
      else onNext();
    }, duration);
    return () => {
      if (autoplayTimerRef.current) window.clearTimeout(autoplayTimerRef.current);
    };
  }, [activeIndex, activeItem, interactionHold, isPlaying, items.length, onNext, speed]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Don't hijack keys while editing or typing in a field — otherwise Space
      // toggles playback instead of inserting a space, and the arrows jump items
      // instead of moving the cursor. Gate on the editor's own state (the
      // keydown target is unreliable on mobile virtual keyboards) plus the
      // focused element, which also covers the filter selects.
      const isEditable = (el: Element | null) =>
        el instanceof HTMLElement && (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT");
      if (editingCaption || isEditable(event.target as Element | null) || isEditable(document.activeElement)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        noteInteraction();
        onNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        noteInteraction();
        onPrev();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === " ") {
        event.preventDefault();
        setIsPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingCaption, onClose, onNext, onPrev]);

  // Warm the browser cache for the neighbouring photos so next/prev swaps in an
  // already-decoded image instead of stalling on a fresh full-size download.
  useEffect(() => {
    const urls = [1, -1, 2]
      .map((offset) => items[activeIndex + offset])
      .filter((item) => item?.kind === "photo" && item.primary.media_type !== "video")
      .map((item) => (item as Extract<JourneyItem, { kind: "photo" }>).primary.image_url)
      .filter((url): url is string => Boolean(url));
    const preloaded = urls.map((url) => {
      const img = new window.Image();
      img.decoding = "async";
      img.src = url;
      return img;
    });
    return () => { preloaded.forEach((img) => { img.src = ""; }); };
  }, [activeIndex, items]);

  const filterControls = (
    <>
      <select value={filter} onChange={(event) => onFilterChange(event.target.value as JourneyFilter)} className="max-w-[8rem] rounded-full border border-white/15 bg-stone-950/45 px-3 py-2 text-xs font-bold text-white outline-none backdrop-blur focus:ring-4 focus:ring-white/20">
        <option value="all">All</option>
        <option value="photos">Media</option>
        <option value="journal">Journal</option>
      </select>
      {uploaders.length > 0 ? (
        <select value={uploaderFilter} onChange={(event) => onUploaderFilterChange(event.target.value)} className="hidden max-w-[10rem] rounded-full border border-white/15 bg-stone-950/45 px-3 py-2 text-xs font-bold text-white outline-none backdrop-blur focus:ring-4 focus:ring-white/20 sm:block">
          <option value="">Everyone</option>
          {uploaders.map((uploader) => <option key={uploader} value={uploader}>{friendlyPersonName(uploader)}</option>)}
        </select>
      ) : null}
    </>
  );

  // Filters can narrow the list to nothing. Keep the viewer open with its filter
  // controls (and a reset) rather than trapping the user behind a bare Close.
  if (!activeItem) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-stone-950 text-white">
        <div className="flex items-center justify-between gap-3 px-3 py-3 md:px-6 md:py-5">
          <button onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25" aria-label="Close journey">
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">{filterControls}</div>
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div>
            <div className="font-serif text-3xl font-semibold">No items match this filter</div>
            <p className="mt-2 text-sm text-white/70">Switch the filter back to see the rest of the journey.</p>
            <button onClick={() => { onFilterChange("all"); onUploaderFilterChange(""); }} className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-black text-stone-950 transition hover:bg-[#fff4d8]">Show all items</button>
          </div>
        </div>
      </div>
    );
  }

  const title = journeyItemTitle(activeItem);
  const date = formatDateTime(itemDate(activeItem));
  const canEditCaption = activeItem.kind === "photo" && photoCanEdit(activeItem.primary, currentUserId, isAdmin);
  const progress = items.length <= 1 ? 1 : activeIndex / (items.length - 1);
  // The backdrop is heavily blurred, so the small thumbnail is indistinguishable
  // from the full image while costing a fraction of the bytes and decode/GPU work.
  const backgroundUrl = activeItem.kind === "photo"
    ? activeItem.primary.media_type === "video"
      ? activeItem.primary.thumbnail_url
      : (activeItem.primary.thumbnail_url ?? activeItem.primary.image_url)
    : null;
  const imageUrl = activeItem.kind === "photo" && activeItem.primary.media_type !== "video" ? activeItem.primary.image_url : null;
  const videoUrl = activeItem.kind === "photo" && activeItem.primary.media_type === "video" ? activeItem.primary.image_url : null;

  async function saveCaption() {
    if (activeItem.kind !== "photo") return;
    await onUpdatePhoto(activeItem.primary.id, photoUpdateWithCaption(activeItem.primary, captionDraft.trim() || null));
    setEditingCaption(false);
  }

  function touchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    noteInteraction();
  }

  function touchEnd(event: React.TouchEvent) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 44 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    if (deltaX < 0) onNext();
    else onPrev();
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-stone-950 text-white" onPointerDown={noteInteraction} onTouchStart={touchStart} onTouchEnd={touchEnd}>
      {backgroundUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- User-uploaded image URLs are rendered directly in the viewer. */}
          <img src={backgroundUrl} alt="" aria-hidden decoding="async" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl" />
          <div className="absolute inset-0 bg-stone-950/46" />
        </>
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_16%,rgba(231,161,61,0.22),transparent_32%),linear-gradient(135deg,#1c1917,#263f38_58%,#0c1715)]" />
      )}

      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 px-3 py-3 md:px-6 md:py-5">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={onClose} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25" aria-label="Close journey">
            <X className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold uppercase tracking-[0.14em] text-white/65">Journey Mode</div>
            <div className="truncate text-sm font-bold text-white">{dayLabel(days, activeItem.dayId)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {filterControls}
          <button onClick={() => navigator.clipboard?.writeText(window.location.href)} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25" aria-label="Copy share link">
            <Link className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex h-full items-center justify-center px-4 pb-36 pt-20 md:px-16 md:pb-28 md:pt-24">
        {videoUrl ? (
          <div className="flex h-full w-full items-center justify-center">
            <video
              key={videoUrl}
              src={videoUrl}
              poster={activeItem.kind === "photo" ? activeItem.primary.thumbnail_url ?? undefined : undefined}
              autoPlay={isPlaying}
              muted={isPlaying}
              playsInline
              controls
              onLoadedMetadata={(event) => {
                if (!isPlayingRef.current) return;
                const video = event.currentTarget;
                void video.play().catch(() => {
                  const durationMs = Number.isFinite(video.duration) && video.duration > 0
                    ? (video.duration * 1000) / speed
                    : 30000;
                  scheduleVideoAdvance(durationMs);
                });
              }}
              onEnded={() => {
                if (videoFallbackTimerRef.current) window.clearTimeout(videoFallbackTimerRef.current);
                advanceVideoInSlideshow();
              }}
              onError={() => {
                if (!isPlayingRef.current) return;
                scheduleVideoAdvance(5000);
              }}
              className="max-h-full max-w-full rounded-lg object-contain shadow-[0_36px_100px_rgba(0,0,0,0.45)]"
            />
          </div>
        ) : imageUrl ? (
          <div className="flex h-full w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- User-uploaded image URLs are rendered directly in the viewer. */}
            <img src={imageUrl} alt={title} decoding="async" fetchPriority="high" className="max-h-full max-w-full rounded-lg object-contain shadow-[0_36px_100px_rgba(0,0,0,0.45)]" />
          </div>
        ) : (
          <article className="mx-auto max-w-2xl rounded-xl border border-white/15 bg-[rgba(255,253,246,0.94)] p-6 text-stone-950 shadow-[0_36px_100px_rgba(0,0,0,0.3)]">
            <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-teal-800">{itemKindLabel(activeItem)}</div>
            <h2 className="font-serif text-3xl font-semibold leading-tight">{title}</h2>
            {activeItem.kind === "place" && activeItem.primary.description ? <p className="mt-4 text-sm leading-6 text-stone-700">{activeItem.primary.description}</p> : null}
          </article>
        )}
      </div>

      <button onClick={() => { noteInteraction(); onPrev(); }} className="absolute left-3 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25 md:inline-flex" aria-label="Previous item">
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button onClick={() => { noteInteraction(); onNext(); }} className="absolute right-3 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25 md:inline-flex" aria-label="Next item">
        <ChevronRight className="h-6 w-6" />
      </button>

      <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-stone-950 via-stone-950/86 to-transparent px-3 pb-3 pt-16 md:px-6 md:pb-5">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 max-w-2xl">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-white/58">
              <span>{itemKindLabel(activeItem)}</span>
              <span>{date}</span>
              {activeItem.kind === "photo" && activeItem.primary.uploader_name ? <span>by {friendlyPersonName(activeItem.primary.uploader_name)}</span> : null}
              {!activeItem.coord ? <span>location unknown</span> : null}
            </div>
            {activeItem.kind === "photo" ? (
              <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-white/15 bg-stone-950/45 p-3 backdrop-blur md:max-w-xl">
                {editingCaption ? (
                  <div className="space-y-2">
                    <textarea value={captionDraft} onChange={(event) => setCaptionDraft(event.target.value)} className="min-h-20 w-full rounded-lg border border-white/15 bg-white/95 px-3 py-2 text-sm text-stone-950 outline-none focus:ring-4 focus:ring-white/25" placeholder="Caption" />
                    <div className="flex gap-2">
                      <button disabled={isSaving} onClick={saveCaption} className="inline-flex items-center gap-2 rounded-lg bg-[#e7a13d] px-3 py-2 text-sm font-black text-stone-950 transition hover:bg-[#f0ae4b] disabled:opacity-50">
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                      </button>
                      <button onClick={() => setEditingCaption(false)} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/20">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <p className="min-w-0 flex-1 text-sm leading-6 text-white">{activeItem.primary.caption || "No caption yet."}</p>
                    {canEditCaption ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button onClick={() => setEditingCaption(true)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20" aria-label="Edit caption" title="Edit caption">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => onEditPhoto(activeItem.primary.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20" aria-label="Edit photo details (location, day, time)" title="Edit details — location, day, time">
                          <MapPinned className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
                {activeItem.attached.length > 0 ? (
                  <div className="mt-3 space-y-2 border-t border-white/12 pt-3">
                    {activeItem.attached.map((attached) => (
                      <div key={`${attached.kind}:${attached.item.id}`} className="rounded-lg bg-white/8 px-3 py-2 text-xs leading-5 text-white/82">
                        <span className="mr-2 font-black uppercase tracking-[0.12em] text-white/48">{attached.kind}</span>{attachedText(attached)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="max-w-xl rounded-xl border border-white/15 bg-[rgba(255,253,246,0.94)] p-3 text-sm leading-6 text-stone-800 shadow-xl">
                {activeItem.kind === "note" ? activeItem.primary.body : activeItem.primary.description || activeItem.primary.name}
              </div>
            )}
          </div>

          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setIsPlaying((value) => !value)} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-stone-950 shadow-lg transition hover:bg-[#fff4d8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30" aria-label={isPlaying ? "Pause autoplay" : "Start autoplay"}>
                {isPlaying ? <CirclePause className="h-5 w-5" /> : <CirclePlay className="h-5 w-5" />}
              </button>
              <div className="flex items-center gap-1.5" title="Autoplay speed">
                <Gauge className="hidden h-3.5 w-3.5 shrink-0 text-white/45 sm:block" />
                <input type="range" min={0.5} max={2.5} step={0.5} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="w-14 cursor-pointer accent-[#e7a13d] sm:w-20" aria-label="Autoplay speed" />
                <span className="w-7 text-[11px] font-bold tabular-nums text-white/60">{speed}×</span>
              </div>
            </div>
            <div className="relative h-9">
              <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/16">
                <div className="h-full rounded-full bg-[#e7a13d]" style={{ width: `${Math.max(2, progress * 100)}%` }} />
              </div>
              {items.map((item, index) => {
                const isDayStart = index === 0 || item.dayId !== items[index - 1]?.dayId;
                if (!isDayStart) return null;
                return (
                  <button
                    key={`${item.dayId ?? "unsorted"}:${index}`}
                    onClick={() => onSelectIndex(index)}
                    className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-stone-950 bg-white shadow"
                    style={{ left: `${items.length <= 1 ? 0 : (index / (items.length - 1)) * 100}%` }}
                    aria-label={`Jump to ${dayLabel(days, item.dayId)}`}
                    title={`${dayLabel(days, item.dayId)} ${formatDateOnly(days.find((day) => day.id === item.dayId)?.date)}`}
                  />
                );
              })}
              <input type="range" min={0} max={Math.max(0, items.length - 1)} value={activeIndex} onChange={(event) => onSelectIndex(Number(event.target.value))} className="absolute inset-0 h-9 w-full cursor-pointer opacity-0" aria-label="Journey progress" />
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => { noteInteraction(); onPrev(); }} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white transition hover:bg-white/20 md:hidden" aria-label="Previous item"><ChevronLeft className="h-5 w-5" /></button>
              <span className="min-w-14 text-center text-xs font-bold text-white/60">{activeIndex + 1} / {items.length}</span>
              <button onClick={() => { noteInteraction(); onNext(); }} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-white transition hover:bg-white/20 md:hidden" aria-label="Next item"><ChevronRight className="h-5 w-5" /></button>
            </div>
          </div>
        </div>
      </div>

      <JourneyMiniMap routes={routes} days={days} items={items} activeItem={activeItem} onInteraction={noteInteraction} onSelectItem={onSelectItem} />
    </div>
  );
}
