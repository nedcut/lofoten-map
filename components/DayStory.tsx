"use client";

import { ArrowLeft, ArrowRight, MapPin, Play, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DayStatsRow, type DayStats } from "@/components/DaySidebar";
import { MOBILE_SHEET_HEIGHT_VAR } from "@/components/MobileSheet";
import { buildStoryBlocks, storyTimeLabel } from "@/lib/day-story";
import { friendlyPersonName } from "@/lib/display-name";
import { startJourneyAtDayLabel, type JourneyAttachedItem, type JourneyItem } from "@/lib/journey";
import { nightLight, nightLightLabel } from "@/lib/sun";
import { cn, formatDateOnly } from "@/lib/utils";
import type { Day } from "@/types/trip";

// On desktop the story floats where the sidebar does, a little wider for
// reading: 1rem margin + 28rem column + 1rem breathing room. page.tsx frames
// the map into what is left.
export const STORY_INSET_PX = 480;

type Props = {
  day: Day;
  color: string;
  stats: DayStats | undefined;
  /** The day's journey items, in the order Journey Mode plays them. */
  items: JourneyItem[];
  previousDay: Day | null;
  nextDay: Day | null;
  onSelectDay: (dayId: string) => void;
  onClose: () => void;
  onPlayDay: (dayId: string) => void;
  /** Open Journey Mode on this photo, playing on from there. */
  onOpenPhoto: (photoId: string) => void;
  /** The entry being read, which the map follows; null at the day's opening. */
  onActiveItemChange: (itemId: string | null) => void;
};

// The reading line: an entry counts as "being read" while it crosses this
// band a little above the middle of the scroll area.
const READING_BAND = "-38% 0px -52% 0px";
const OPENING_ID = "";

function dayTitle(day: Day) {
  return day.title ?? "Open trail";
}

function MetaLine({ item }: { item: JourneyItem }) {
  const time = storyTimeLabel(item);
  const person = item.kind === "photo" ? friendlyPersonName(item.primary.uploader_name) : item.kind === "note" ? friendlyPersonName(item.primary.author_name) : null;
  const light = item.kind === "photo" && item.coord ? nightLight(item.primary.taken_at, item.coord.lat, item.coord.lng) : null;
  if (!time && !person && !light) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
      {time ? <span className="tabular-nums">{time}</span> : null}
      {time && person ? <span aria-hidden>·</span> : null}
      {person ? <span className="normal-case tracking-normal">{person}</span> : null}
      {light ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#fbe7c6] px-2 py-0.5 text-[10px] tracking-[0.1em] text-ember-700">
          <Sun className="h-3 w-3" /> {nightLightLabel(light)}
        </span>
      ) : null}
    </div>
  );
}

function NoteText({ body, author, color }: { body: string; author?: string | null; color: string }) {
  return (
    <blockquote className="border-l-2 pl-4" style={{ borderColor: `color-mix(in srgb, ${color} 55%, transparent)` }}>
      <p className="whitespace-pre-line font-serif text-[1.05rem] leading-7 text-stone-800">{body}</p>
      {author ? <footer className="mt-1 text-xs font-semibold text-stone-500">{author}</footer> : null}
    </blockquote>
  );
}

function PlaceLine({ name, description, type }: { name: string; description: string | null; type: string | null }) {
  return (
    <div className="flex gap-3 rounded-xl bg-paper-tint px-3.5 py-3">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-fjord" />
      <div className="min-w-0">
        <div className="text-sm font-bold text-stone-900">{name}{type ? <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.1em] text-teal-800/80">{type}</span> : null}</div>
        {description ? <p className="mt-0.5 text-[13px] leading-5 text-stone-600">{description}</p> : null}
      </div>
    </div>
  );
}

function Attached({ attached, color }: { attached: JourneyAttachedItem[]; color: string }) {
  if (attached.length === 0) return null;
  return (
    <div className="space-y-3">
      {attached.map((entry) => entry.kind === "note"
        ? <NoteText key={`note:${entry.item.id}`} body={entry.item.body} author={friendlyPersonName(entry.item.author_name)} color={color} />
        : <PlaceLine key={`place:${entry.item.id}`} name={entry.item.name} description={entry.item.description} type={entry.item.place_type} />)}
    </div>
  );
}

function PhotoButton({ item, onOpen, className, imgClassName, thumb = false }: { item: Extract<JourneyItem, { kind: "photo" }>; onOpen: () => void; className?: string; imgClassName?: string; thumb?: boolean }) {
  const photo = item.primary;
  const src = (thumb ? photo.thumbnail_url ?? photo.image_url : photo.image_url ?? photo.thumbnail_url) ?? undefined;
  if (!src) return null;
  return (
    <button type="button" onClick={onOpen} aria-label={`Relive from ${photo.caption?.trim() || "this photo"}`} className={cn("group/photo relative block w-full overflow-hidden rounded-xl bg-stone-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- user media URLs from R2 */}
      <img src={src} alt={photo.caption?.trim() || ""} loading="lazy" decoding="async" className={cn("w-full transition-transform duration-700 group-hover/photo:scale-[1.025] motion-reduce:transition-none", imgClassName)} />
      <span aria-hidden className="absolute bottom-2.5 right-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-paper/90 text-ember-600 opacity-0 shadow-md transition group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100">
        <Play className="h-3.5 w-3.5 fill-current" />
      </span>
    </button>
  );
}

function EntryBody({ item, color, onOpen }: { item: JourneyItem; color: string; onOpen: () => void }) {
  if (item.kind === "photo") {
    const photo = item.primary;
    return (
      <div className="space-y-2.5">
        <MetaLine item={item} />
        {photo.media_type === "video" && photo.image_url ? (
          <video src={photo.image_url} poster={photo.thumbnail_url ?? undefined} controls playsInline preload="metadata" className="w-full rounded-xl bg-stone-900" />
        ) : (
          <PhotoButton item={item} onOpen={onOpen} imgClassName="max-h-[34rem] object-cover" />
        )}
        {photo.caption?.trim() ? <p className="text-[15px] leading-6 text-stone-800">{photo.caption.trim()}</p> : null}
        <Attached attached={item.attached} color={color} />
      </div>
    );
  }
  if (item.kind === "note") {
    return (
      <div className="space-y-2">
        <MetaLine item={item} />
        <NoteText body={item.primary.body} color={color} />
        <Attached attached={item.attached} color={color} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <PlaceLine name={item.primary.name} description={item.primary.description} type={item.primary.place_type} />
      <Attached attached={item.attached} color={color} />
    </div>
  );
}

// The dot on the trail line beside each entry; it fills in while that entry
// is the one the map is showing.
function TrailDot({ active, color }: { active: boolean; color: string }) {
  return (
    <span
      aria-hidden
      className={cn("absolute left-0 top-1 h-[11px] w-[11px] rounded-full border-2 transition-transform duration-300 motion-reduce:transition-none", active && "scale-125")}
      style={{ borderColor: color, backgroundColor: active ? color : "var(--color-paper)" }}
    />
  );
}

export function DayStory({ day, color, stats, items, previousDay, nextDay, onSelectDay, onClose, onPlayDay, onOpenPhoto, onActiveItemChange }: Props) {
  const blocks = useMemo(() => buildStoryBlocks(items), [items]);
  const panelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const onActiveRef = useRef(onActiveItemChange);
  useEffect(() => {
    onActiveRef.current = onActiveItemChange;
  }, [onActiveItemChange]);

  // Follow the reading line: whichever entry (or the day's opening) crosses
  // it becomes active, and the map eases to it.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      const crossing = entries.filter((entry) => entry.isIntersecting);
      if (crossing.length === 0) return;
      const id = (crossing[crossing.length - 1].target as HTMLElement).dataset.storyId ?? OPENING_ID;
      const next = id === OPENING_ID ? null : id;
      setActiveId(next);
      onActiveRef.current(next);
    }, { root, rootMargin: READING_BAND, threshold: 0 });
    root.querySelectorAll("[data-story-id]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [blocks]);

  // The control that opened the story (a day card's Read button) is hidden
  // beneath it, so keyboard focus moves into the story. Leaving it hands the
  // map back to the whole day.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    return () => onActiveRef.current(null);
  }, []);

  // On phones the story is a bottom panel over the map; publish its height
  // the way the day sheet does, so map framing and controls stay clear of it.
  useEffect(() => {
    const node = panelRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(MOBILE_SHEET_HEIGHT_VAR, `${Math.round(node.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(MOBILE_SHEET_HEIGHT_VAR);
    };
  }, []);

  const hasContent = items.length > 0;
  const titleId = `story-title-${day.id}`;

  return (
    <article
      ref={panelRef}
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed outline-none inset-x-0 bottom-0 z-30 flex h-[55dvh] flex-col overflow-hidden rounded-t-panel border border-white/60 bg-paper/95 text-stone-950 shadow-[0_-12px_60px_rgba(46,61,54,0.28)] backdrop-blur-2xl backdrop-saturate-150 md:absolute md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:h-auto md:w-[28rem] md:rounded-panel md:bg-paper/90 md:shadow-panel"
    >
      {/* Close sits outside the scroller so it stays put while reading. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close story"
        title="Back to the map"
        className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-paper/85 text-stone-500 shadow-sm ring-1 ring-stone-900/5 backdrop-blur transition hover:bg-white hover:text-stone-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20"
      >
        <X className="h-4 w-4" />
      </button>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 md:px-7 md:pt-7">
        <header data-story-id={OPENING_ID} className="space-y-3 pb-7 pr-10">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            Day {day.day_number}{day.date ? ` · ${formatDateOnly(day.date)}` : ""}
          </div>
          <h2 id={titleId} className="font-serif text-[2.1rem] font-semibold leading-[1.02] tracking-tight text-stone-950 md:text-[2.4rem]">{dayTitle(day)}</h2>
          {day.summary ? <p className="font-serif text-[1.05rem] italic leading-7 text-stone-600">{day.summary}</p> : null}
          <DayStatsRow stats={stats} />
          {hasContent ? (
            <button
              type="button"
              onClick={() => onPlayDay(day.id)}
              aria-label={startJourneyAtDayLabel(day.day_number)}
              className="mt-1 inline-flex items-center gap-2 rounded-full bg-[#0f3b32] py-1.5 pl-1.5 pr-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#13493e] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.98]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ember-400 text-stone-950"><Play className="h-3.5 w-3.5 fill-current" /></span>
              Play from here
            </button>
          ) : null}
        </header>

        {hasContent ? (
          <div className="relative">
            {/* The trail the entries hang from, in the day's colour. */}
            <span aria-hidden className="absolute bottom-3 left-[5px] top-2 w-px" style={{ backgroundColor: `color-mix(in srgb, ${color} 40%, transparent)` }} />
            <ol className="space-y-9">
              {blocks.map((block) => {
                if (block.kind === "gallery") {
                  const first = block.items[0];
                  const active = block.items.some((item) => item.id === activeId);
                  return (
                    <li key={`gallery:${first.id}`} className="relative pl-7">
                      <TrailDot active={active} color={color} />
                      <div className="space-y-2.5">
                        <MetaLine item={first} />
                        <div className={cn("grid gap-1.5", block.items.length === 2 || block.items.length === 4 ? "grid-cols-2" : "grid-cols-3")}>
                          {block.items.map((item) => (
                            <div key={item.id} data-story-id={item.id}>
                              <PhotoButton item={item} onOpen={() => onOpenPhoto(item.primary.id)} thumb className="aspect-square rounded-lg" imgClassName="h-full object-cover" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </li>
                  );
                }
                const { item } = block;
                return (
                  <li key={item.id} data-story-id={item.id} className="relative pl-7">
                    <TrailDot active={activeId === item.id} color={color} />
                    <EntryBody item={item} color={color} onOpen={() => onOpenPhoto(item.primary.id)} />
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <p className="rounded-xl bg-paper-tint px-4 py-5 text-sm leading-6 text-stone-600">Nothing has been written or photographed for this day yet.</p>
        )}

        {previousDay || nextDay ? (
          <nav aria-label="Other days" className="mt-12 grid grid-cols-2 gap-2 border-t border-stone-200/80 pt-5">
            {previousDay ? (
              <button type="button" onClick={() => onSelectDay(previousDay.id)} className="rounded-xl px-3 py-2.5 text-left transition hover:bg-paper-tint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20">
                <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500"><ArrowLeft className="h-3 w-3" /> Day {previousDay.day_number}</span>
                <span className="mt-0.5 block truncate font-serif text-base font-semibold text-stone-900">{dayTitle(previousDay)}</span>
              </button>
            ) : <span />}
            {nextDay ? (
              <button type="button" onClick={() => onSelectDay(nextDay.id)} className="rounded-xl px-3 py-2.5 text-right transition hover:bg-paper-tint focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20">
                <span className="flex items-center justify-end gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Day {nextDay.day_number} <ArrowRight className="h-3 w-3" /></span>
                <span className="mt-0.5 block truncate font-serif text-base font-semibold text-stone-900">{dayTitle(nextDay)}</span>
              </button>
            ) : null}
          </nav>
        ) : null}
      </div>
    </article>
  );
}
