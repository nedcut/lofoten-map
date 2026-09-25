"use client";

import { ChevronLeft, ChevronRight, CirclePause, CirclePlay, Gauge, Loader2, MapPinned, Pencil, Plus, RotateCcw, Save, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { JourneyMiniMap } from "@/components/JourneyMiniMap";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { useDialogFocus } from "@/lib/hooks/useDialogFocus";
import { friendlyPersonName, personFilterOptions } from "@/lib/display-name";
import { cn, formatDateOnly, formatDateTime } from "@/lib/utils";
import { journeyItemTitle, type JourneyAttachedItem, type JourneyItem } from "@/lib/journey";
import { syncJourneyVideo, videoFallbackDurationMs } from "@/lib/journey-video";
import { dayColorMap } from "@/lib/day-colors";
import { shareJourneyLink, type ShareResult } from "@/lib/share";
import type { Day, Photo, RouteSegment, Trip } from "@/types/trip";

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
  trip: Trip | null;
  showIntro: boolean;
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

// Autoplay speeds the single speed button cycles through.
const SPEEDS = [1, 1.5, 2] as const;

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
  trip,
  showIntro,
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
  const videoUrl = activeItem?.kind === "photo" && activeItem.primary.media_type === "video" ? activeItem.primary.image_url : null;
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [interactionHold, setInteractionHold] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [editingCaption, setEditingCaption] = useState(false);
  const [introOpen, setIntroOpen] = useState(showIntro);
  const [complete, setComplete] = useState(false);
  const [shareStatus, setShareStatus] = useState<ShareResult | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const autoplayTimerRef = useRef<number | null>(null);
  const videoFallbackTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  // Measured width of the progress track, so day labels that would collide
  // on a narrow screen (eight days across a phone) can be dropped.
  const [trackWidth, setTrackWidth] = useState(0);
  const isPlayingRef = useRef(isPlaying);
  const activeIndexRef = useRef(activeIndex);
  const uploaderOptions = useMemo(
    () => personFilterOptions(allItems.map((item) => item.kind === "photo" ? item.primary.uploader_name : null)),
    [allItems],
  );
  const dayColors = useMemo(() => dayColorMap(days), [days]);
  // Where each day starts along the progress track, for the labelled ticks.
  const dayTicks = useMemo(() => items.flatMap((item, index) => {
    const isDayStart = index === 0 || item.dayId !== items[index - 1]?.dayId;
    if (!isDayStart) return [];
    const day = days.find((entry) => entry.id === item.dayId) ?? null;
    return [{ index, day, left: items.length <= 1 ? 0 : (index / (items.length - 1)) * 100 }];
  }), [days, items]);
  // Which ticks get a "D3" label: walk left to right and only label a tick
  // when it sits far enough from the last labelled one. The current day
  // always keeps its label and its neighbours make way. Dots always render.
  const activeDayId = activeItem ? activeItem.dayId : undefined;
  const labelledTicks = useMemo(() => {
    const labelled = new Set<number>();
    // Until the track is measured, label every day rather than guessing.
    if (trackWidth <= 0) {
      for (const tick of dayTicks) labelled.add(tick.index);
      return labelled;
    }
    const minGapPx = 26;
    const toPx = (left: number) => (left / 100) * trackWidth;
    const active = dayTicks.find((tick) => (tick.day?.id ?? null) === activeDayId);
    const activePx = active ? toPx(active.left) : null;
    let lastLabelledPx = -Infinity;
    for (const tick of dayTicks) {
      const px = toPx(tick.left);
      const isActive = tick === active;
      if (!isActive && (px - lastLabelledPx < minGapPx || (activePx !== null && Math.abs(activePx - px) < minGapPx))) continue;
      labelled.add(tick.index);
      lastLabelledPx = px;
    }
    return labelled;
  }, [activeDayId, dayTicks, trackWidth]);
  const activeDayColor = activeItem?.dayId ? dayColors.get(activeItem.dayId) ?? null : null;
  const selectedUploaderId = uploaderOptions.find((option) => option.value === uploaderFilter)?.id ?? "";

  /* eslint-disable react-hooks/set-state-in-effect -- resets the caption editor to mirror the active item (external selection); intentional sync, not a render cascade. */
  useEffect(() => {
    if (!activeItem || activeItem.kind !== "photo") {
      setCaptionDraft("");
      setEditingCaption(false);
      return;
    }
    setCaptionDraft(activeItem.primary.caption ?? "");
    setEditingCaption(false);
  }, [activeItem]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  // `autoPlay` only affects mounting. Keep the active video synchronized when
  // the shared play/pause control changes after mount, and schedule a timed
  // advance if the browser rejects programmatic playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (videoFallbackTimerRef.current) window.clearTimeout(videoFallbackTimerRef.current);
    syncJourneyVideo(video, isPlaying, () => {
      videoFallbackTimerRef.current = window.setTimeout(() => {
        videoFallbackTimerRef.current = null;
        if (!isPlayingRef.current) return;
        if (activeIndexRef.current >= items.length - 1) { setIsPlaying(false); setComplete(true); }
        else onNext();
      }, Math.max(videoFallbackDurationMs(video.duration, speed), 3000));
    });
  }, [activeIndex, isPlaying, items.length, onNext, speed, videoUrl]);

  // Intro and completion are true modal states: focus enters the dialog, Tab
  // stays within it, and the playback controls behind it cannot receive focus.
  useEffect(() => {
    if (!introOpen && !complete) return;
    const dialog = modalRef.current;
    const controls = dialog?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    controls?.[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [complete, introOpen]);

  // The main viewer is itself a full-screen dialog: initial focus, a Tab trap,
  // and focus restore on close. Disabled while the intro/complete overlay is
  // up (the effect above owns focus then) and doesn't take onClose — the
  // window keydown handler below already closes on Escape.
  // The intro overlay takes focus first, so by the time the viewer dialog
  // activates the "previous" element would be the intro button (or body).
  // Capture the real opener once on mount and restore to it on close.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  useDialogFocus(rootRef, { active: !introOpen && !complete, restoreTo: openerRef });

  function advanceVideoInSlideshow() {
    if (!isPlayingRef.current) return;
    if (activeIndexRef.current >= items.length - 1) { setIsPlaying(false); setComplete(true); }
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
    if (!isPlaying || interactionHold || !activeItem || (activeItem.kind === "photo" && activeItem.primary.media_type === "video")) return;
    const baseDuration = activeItem.kind === "photo" && !activeItem.primary.caption ? 5000 : 7000;
    const duration = baseDuration / speed;
    const isLast = activeIndex >= items.length - 1;
    autoplayTimerRef.current = window.setTimeout(() => {
      // Autoplay runs through the journey once and then pauses on the final
      // item; manual prev/next still wraps for convenience.
      if (isLast) { setIsPlaying(false); setComplete(true); }
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
      // Space on a focused Close/Share/nav button should activate that button,
      // not toggle autoplay — match PlacementWorkspace's own space-key guard.
      const isActivatable = (el: Element | null) =>
        el instanceof HTMLElement && (el.tagName === "BUTTON" || el.tagName === "A");
      if (editingCaption || isEditable(event.target as Element | null) || isEditable(document.activeElement)) return;
      if (event.key === " " && (isActivatable(event.target as Element | null) || isActivatable(document.activeElement))) return;
      if (introOpen || complete) {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        return;
      }
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
  }, [complete, editingCaption, introOpen, onClose, onNext, onPrev]);

  // Warm the browser cache for the neighbouring photos so next/prev swaps in an
  // already-decoded image instead of stalling on a fresh full-size download.
  // Downloads survive a step while their photo is still in the window (the
  // active one included), so stepping forward doesn't abort and restart the
  // photo two ahead that is now one ahead.
  const preloadsRef = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    const urls = new Set([0, 1, -1, 2]
      .map((offset) => items[activeIndex + offset])
      .filter((item) => item?.kind === "photo" && item.primary.media_type !== "video")
      .map((item) => (item as Extract<JourneyItem, { kind: "photo" }>).primary.image_url)
      .filter((url): url is string => Boolean(url)));
    const preloads = preloadsRef.current;
    for (const [url, img] of preloads) {
      if (urls.has(url)) continue;
      img.src = "";
      preloads.delete(url);
    }
    for (const url of urls) {
      if (preloads.has(url)) continue;
      const img = new window.Image();
      img.decoding = "async";
      img.src = url;
      preloads.set(url, img);
    }
  }, [activeIndex, items]);
  useEffect(() => {
    const preloads = preloadsRef.current;
    return () => {
      preloads.forEach((img) => { img.src = ""; });
      preloads.clear();
    };
  }, []);

  // The bottom bar's height depends on the caption and attached notes, so the
  // media area reads it from a CSS variable instead of guessing with a fixed
  // padding. Without this a long caption on a phone covers the photo.
  useEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root || typeof ResizeObserver === "undefined") return;
    const publish = () => root.style.setProperty("--journey-bar-height", `${Math.round(bar.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [activeItem]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const publish = () => setTrackWidth(track.getBoundingClientRect().width);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeItem]);

  const filterControls = (
    <>
      <select value={filter} onChange={(event) => onFilterChange(event.target.value as JourneyFilter)} aria-label="Filter journey by type" className="max-w-[8rem] rounded-full border border-white/15 bg-stone-950/45 px-3 py-2 text-xs font-bold text-white outline-none backdrop-blur focus:ring-4 focus:ring-white/20">
        <option value="all">All</option>
        <option value="photos">Media</option>
        <option value="journal">Journal</option>
      </select>
      {uploaderOptions.length > 0 ? (
        <select
          value={selectedUploaderId}
          onChange={(event) => onUploaderFilterChange(uploaderOptions.find((option) => option.id === event.target.value)?.value ?? "")}
          aria-label="Filter journey by uploader"
          className="hidden max-w-[10rem] rounded-full border border-white/15 bg-stone-950/45 px-3 py-2 text-xs font-bold text-white outline-none backdrop-blur focus:ring-4 focus:ring-white/20 sm:block"
        >
          <option value="">Everyone</option>
          {uploaderOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      ) : null}
    </>
  );

  // Filters can narrow the list to nothing. Keep the viewer open with its filter
  // controls (and a reset) rather than trapping the user behind a bare Close.
  if (!activeItem) {
    return (
      <div ref={rootRef} role="dialog" aria-modal="true" aria-label="Journey Mode" className="fixed inset-0 z-50 flex flex-col bg-stone-950 text-white">
        <div className="flex items-center justify-between gap-3 px-3 py-3 md:px-6 md:py-5">
          <IconButton onClick={onClose} aria-label="Close journey">
            <X className="h-5 w-5" />
          </IconButton>
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

  async function saveCaption() {
    if (activeItem.kind !== "photo") return;
    await onUpdatePhoto(activeItem.primary.id, photoUpdateWithCaption(activeItem.primary, captionDraft.trim() || null));
    setEditingCaption(false);
  }

  async function shareJourney() {
    const result = await shareJourneyLink(navigator, {
      title: trip?.title ?? "this trip",
      text: trip?.title ? `Relive our ${trip.title} journey.` : "Relive our journey.",
      url: window.location.href,
    });
    if (result === "cancelled") return;
    setShareStatus(result);
    window.setTimeout(() => setShareStatus(null), 2500);
  }

  function replay() {
    setComplete(false);
    setIntroOpen(false);
    onSelectIndex(0);
    setIsPlaying(true);
  }

  function touchStart(event: React.TouchEvent) {
    noteInteraction();
    // A horizontal drag on the progress slider, the mini-map, or a text field
    // is not a swipe: without this, scrubbing the slider also flipped a slide.
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input[type="range"], [data-journey-minimap], textarea, select')) {
      touchStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
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

  // The intro/complete overlays are themselves dialogs (see below); the root
  // only claims the dialog role while neither is showing, so the page never
  // has two nested aria-modal dialogs at once.
  const rootIsDialog = !introOpen && !complete;

  return (
    <div ref={rootRef} {...(rootIsDialog ? { role: "dialog" as const, "aria-modal": true, "aria-label": "Journey Mode" } : {})} className="fixed inset-0 z-50 overflow-hidden bg-stone-950 text-white" onPointerDown={noteInteraction} onTouchStart={touchStart} onTouchEnd={touchEnd}>
      {backgroundUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- User-uploaded image URLs are rendered directly in the viewer. */}
          <img src={backgroundUrl} alt="" aria-hidden decoding="async" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl" />
          <div className="absolute inset-0 bg-stone-950/46" />
        </>
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_16%,rgba(231,161,61,0.22),transparent_32%),linear-gradient(135deg,#1c1917,#263f38_58%,#0c1715)]" />
      )}

      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between gap-3 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-6 md:py-5">
        <div className="flex min-w-0 items-center gap-2">
          <IconButton onClick={onClose} aria-label="Close journey">
            <X className="h-5 w-5" />
          </IconButton>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold uppercase tracking-[0.14em] text-white/65">Journey Mode</div>
            <div className="truncate text-sm font-bold text-white">{dayLabel(days, activeItem.dayId)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {filterControls}
          <IconButton onClick={shareJourney} aria-label="Share journey">
            <Share2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      {shareStatus ? <div role="status" className="absolute right-4 top-16 z-50 rounded-full bg-white px-3 py-2 text-xs font-bold text-stone-950 shadow-xl">{shareStatus === "copied" ? "Link copied" : shareStatus === "shared" ? "Journey shared" : "Couldn’t share link"}</div> : null}

      {introOpen ? (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="journey-intro-title" className="absolute inset-0 z-50 flex items-center justify-center bg-stone-950/72 p-6 backdrop-blur-md">
          <section className="max-w-xl text-center">
            <div className="text-xs font-black uppercase tracking-[0.24em] text-ember-400">A shared travel story</div>
            {/* h2, not h1 — the app already has an h1 for the trip title (DaySidebar),
                and this overlay is transient. */}
            <h2 id="journey-intro-title" className="mt-4 font-serif text-5xl font-semibold md:text-7xl">{trip?.title ?? "this trip"}</h2>
            {trip?.description ? <p className="mx-auto mt-5 max-w-lg text-base leading-7 text-white/75">{trip.description}</p> : null}
            <p className="mt-3 text-sm text-white/55">{items.length} moments across {days.length} days</p>
            <Button onClick={() => { setIntroOpen(false); setIsPlaying(true); }} className="mt-8 rounded-full px-6"><CirclePlay className="h-5 w-5" /> Begin journey</Button>
          </section>
        </div>
      ) : null}

      {complete ? (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="journey-complete-title" className="absolute inset-0 z-50 flex items-center justify-center bg-stone-950/76 p-6 backdrop-blur-md">
          <section className="max-w-xl text-center">
            <div className="text-xs font-black uppercase tracking-[0.24em] text-ember-400">End of the journey</div>
            <h2 id="journey-complete-title" className="mt-4 font-serif text-5xl font-semibold">Thanks for coming along.</h2>
            <p className="mt-4 text-white/65">{items.length} moments from {days.length} days{trip?.title ? ` in ${trip.title}` : ""}.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button onClick={replay} className="rounded-full px-5"><RotateCcw className="h-4 w-4" /> Replay</Button>
              <button onClick={shareJourney} className="inline-flex items-center gap-2 rounded-full bg-white/12 px-5 py-3 font-bold text-white"><Share2 className="h-4 w-4" /> Share</button>
              <button onClick={onClose} className="rounded-full bg-white/12 px-5 py-3 font-bold text-white">Return to map</button>
            </div>
          </section>
        </div>
      ) : null}

      {/* Media fills whatever the header and the measured bottom bar leave
          free; the 2rem lets it run into the bar's transparent gradient top. */}
      <div className="relative z-10 flex h-full items-center justify-center px-2 pb-[calc(var(--journey-bar-height,13rem)-2rem)] pt-[calc(4.25rem+env(safe-area-inset-top))] md:px-16 md:pt-24">
        {videoUrl ? (
          <div className="flex h-full w-full items-center justify-center">
            <video
              ref={videoRef}
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
                  const durationMs = videoFallbackDurationMs(video.duration, speed);
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
          <article className="mx-auto max-w-2xl rounded-xl border border-white/15 bg-paper/94 p-6 text-stone-950 shadow-[0_36px_100px_rgba(0,0,0,0.3)]">
            <div className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-teal-800">{itemKindLabel(activeItem)}</div>
            <h2 className="font-serif text-3xl font-semibold leading-tight">{title}</h2>
            {activeItem.kind === "place" && activeItem.primary.description ? <p className="mt-4 text-sm leading-6 text-stone-700">{activeItem.primary.description}</p> : null}
          </article>
        )}
      </div>

      <IconButton onClick={() => { noteInteraction(); onPrev(); }} className="absolute left-3 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 md:inline-flex" aria-label="Previous item">
        <ChevronLeft className="h-6 w-6" />
      </IconButton>
      <IconButton onClick={() => { noteInteraction(); onNext(); }} className="absolute right-3 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 md:inline-flex" aria-label="Next item">
        <ChevronRight className="h-6 w-6" />
      </IconButton>

      {/* On desktop the mini-map sits in the bottom-right corner; JourneyMiniMap
          publishes its width so the bar can keep its controls clear of it. */}
      <div ref={barRef} className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-stone-950 via-stone-950/86 to-transparent px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-12 md:px-6 md:pb-5 md:pt-16 md:pr-[calc(var(--journey-minimap-width,18rem)+3rem)]">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 max-w-2xl">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-white/58">
              <span>{itemKindLabel(activeItem)}</span>
              <span>{date}</span>
              {activeItem.kind === "photo" && activeItem.primary.uploader_name ? <span>by {friendlyPersonName(activeItem.primary.uploader_name)}</span> : null}
              {!activeItem.coord ? <span>location unknown</span> : null}
            </div>
            {activeItem.kind === "photo" && !activeItem.primary.caption && !canEditCaption && activeItem.attached.length === 0 ? null : activeItem.kind === "photo" ? (
              <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-white/15 bg-stone-950/45 p-3 backdrop-blur md:max-w-xl">
                {editingCaption ? (
                  <div className="space-y-2">
                    <textarea value={captionDraft} onChange={(event) => setCaptionDraft(event.target.value)} className="min-h-20 w-full rounded-lg border border-white/15 bg-white/95 px-3 py-2 text-sm text-stone-950 outline-none focus:ring-4 focus:ring-white/25" placeholder="Caption" />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={isSaving} onClick={saveCaption} className="px-3 py-2">
                        {isSaving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Save className="h-4 w-4" />} Save
                      </Button>
                      <button onClick={() => setEditingCaption(false)} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-bold text-white transition hover:bg-white/20">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    {activeItem.primary.caption ? (
                      <p className="min-w-0 flex-1 text-sm leading-6 text-white">{activeItem.primary.caption}</p>
                    ) : (
                      // Only reachable by people who can edit (see the guard
                      // above), so the empty state is an action, not a shrug.
                      <button type="button" onClick={() => setEditingCaption(true)} className="inline-flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-bold text-white/80 transition hover:text-white">
                        <Plus className="h-4 w-4" /> Add a caption
                      </button>
                    )}
                    {canEditCaption ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        {activeItem.primary.caption ? (
                          <IconButton size="sm" onClick={() => setEditingCaption(true)} aria-label="Edit caption" title="Edit caption" className="rounded-lg bg-white/10 hover:bg-white/20">
                            <Pencil className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                        <IconButton size="sm" onClick={() => onEditPhoto(activeItem.primary.id)} aria-label="Edit photo details (location, day, time)" title="Edit details — location, day, time" className="rounded-lg bg-white/10 hover:bg-white/20">
                          <MapPinned className="h-4 w-4" />
                        </IconButton>
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
              <div className="max-w-xl rounded-xl border border-white/15 bg-paper/94 p-3 text-sm leading-6 text-stone-800 shadow-xl">
                {activeItem.kind === "note" ? activeItem.primary.body : activeItem.primary.description || activeItem.primary.name}
              </div>
            )}
          </div>

          {/* Phones get two rows: the full-width track on top (room for every
              day tick), then play/speed on the left and prev/count/next on
              the right. From md up it collapses to the single-row grid. */}
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-3">
            <div className="col-start-1 row-start-2 flex items-center gap-2 md:row-start-1">
              <button onClick={() => setIsPlaying((value) => !value)} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-stone-950 shadow-lg transition hover:bg-[#fff4d8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30" aria-label={isPlaying ? "Pause autoplay" : "Start autoplay"}>
                {isPlaying ? <CirclePause className="h-5 w-5" /> : <CirclePlay className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={() => setSpeed((current) => SPEEDS[(SPEEDS.indexOf(current as typeof SPEEDS[number]) + 1) % SPEEDS.length])}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-white/10 px-2.5 text-[11px] font-bold tabular-nums text-white/80 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25"
                aria-label={`Autoplay speed ${speed}×, press to change`}
                title="Autoplay speed"
              >
                <Gauge className="hidden h-3.5 w-3.5 shrink-0 text-white/60 sm:block" /> {speed}×
              </button>
            </div>
            {/* The track: a tick per day start, labelled "D1…D8" underneath and
                coloured like the day everywhere else, so scrubbing to a day
                is a matter of aiming rather than hovering to find out. */}
            <div ref={trackRef} className="relative col-span-3 row-start-1 h-11 pt-0.5 md:col-span-1 md:col-start-2">
              <div className="absolute left-0 right-0 top-3.5 h-1 rounded-full bg-white/16">
                <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.max(2, progress * 100)}%`, backgroundColor: activeDayColor ?? "#e7a13d" }} />
              </div>
              {dayTicks.map(({ index, day, left }) => {
                const isActiveDay = activeItem.dayId === (day?.id ?? null);
                const color = day ? dayColors.get(day.id) ?? "#ffffff" : "#ffffff";
                return (
                  <button
                    key={`${day?.id ?? "unsorted"}:${index}`}
                    onClick={() => onSelectIndex(index)}
                    className="absolute top-0 z-10 flex -translate-x-1/2 flex-col items-center"
                    style={{ left: `${left}%` }}
                    aria-label={`Jump to ${dayLabel(days, day?.id ?? null)}`}
                    title={`${dayLabel(days, day?.id ?? null)} ${formatDateOnly(day?.date)}`}
                  >
                    <span className={cn("h-4 w-4 rounded-full border-2 border-stone-950 shadow transition-transform", isActiveDay && "scale-110")} style={{ backgroundColor: color }} />
                    {labelledTicks.has(index) ? (
                      <span className={cn("mt-0.5 text-[10px] font-bold uppercase tabular-nums leading-none", isActiveDay ? "text-white" : "text-white/55")}>{day ? `D${day.day_number}` : "—"}</span>
                    ) : null}
                  </button>
                );
              })}
              <input
                type="range"
                min={0}
                max={Math.max(0, items.length - 1)}
                value={activeIndex}
                onChange={(event) => onSelectIndex(Number(event.target.value))}
                className="absolute inset-x-0 top-0 h-7 w-full cursor-pointer opacity-0"
                aria-label="Journey progress"
                aria-valuetext={`${title}, ${dayLabel(days, activeItem.dayId)}`}
              />
            </div>
            <div className="col-span-2 col-start-2 row-start-2 flex items-center justify-end gap-1 md:col-span-1 md:col-start-3 md:row-start-1">
              <IconButton onClick={() => { noteInteraction(); onPrev(); }} className="md:hidden" aria-label="Previous item"><ChevronLeft className="h-5 w-5" /></IconButton>
              <span className="min-w-14 text-center text-xs font-bold text-white/60">{activeIndex + 1} / {items.length}</span>
              <IconButton onClick={() => { noteInteraction(); onNext(); }} className="md:hidden" aria-label="Next item"><ChevronRight className="h-5 w-5" /></IconButton>
            </div>
          </div>
        </div>
      </div>

      <JourneyMiniMap routes={routes} days={days} items={items} activeItem={activeItem} onInteraction={noteInteraction} onSelectItem={onSelectItem} />
    </div>
  );
}
