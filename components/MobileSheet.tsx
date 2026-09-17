"use client";

import { ChevronLeft, ChevronRight, ChevronUp, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AdminDataPanel } from "@/components/AdminDataPanel";
import { AdminRequestPanel, DayList, DayListSkeleton, LayersPanel, MemberAdminPanel, NotesPlacesList, QuickActions, type SidebarProps } from "@/components/DaySidebar";
import { JourneyHeroCard } from "@/components/JourneyHeroCard";
import { dayColorFor } from "@/lib/day-colors";
import { formatMediaCount } from "@/lib/trip-view-model";
import { cn } from "@/lib/utils";
import type { Day } from "@/types/trip";

// Written to the root element so the Mapbox controls (map-overrides.css) and
// the day-framing padding (page.tsx) can stay clear of the collapsed sheet
// without hard-coding its height.
export const MOBILE_SHEET_HEIGHT_VAR = "--mobile-sheet-height";

// Counts for the current map filter, so the collapsed peek can tell you what's
// visible without expanding the sheet. Notes and places share a marker layer, so
// they're summed together as journal pins.
export type PeekCounts = { routes: number; photos: number; videos: number; notes: number; places: number };

type MobileSheetProps = SidebarProps & { counts: PeekCounts; mapAvailable?: boolean };

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// The label line: which slice of the trip the map is showing.
function dayLabel(selectedDay: Day | null): string {
  if (!selectedDay) return "All days";
  return `Day ${selectedDay.day_number}${selectedDay.title ? `: ${selectedDay.title}` : ""}`;
}

// The prominent line: how much is on the map right now. Nouns are kept short
// so all three parts fit the peek width without truncating. Tweak to taste —
// e.g. add routes, or change the empty-state copy.
function countsLabel(counts: PeekCounts): string {
  const journalPins = counts.notes + counts.places;
  const parts = [];
  if (counts.routes) parts.push(pluralize(counts.routes, "route"));
  const media = formatMediaCount(counts.photos, counts.videos);
  if (media) parts.push(media);
  if (journalPins) parts.push(pluralize(journalPins, "pin"));
  return parts.length > 0 ? parts.join(" · ") : "Nothing on the map yet";
}

export function MobileSheet(props: MobileSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const collapsedRef = useRef<HTMLDivElement | null>(null);
  const selectedDay = props.days.find((day) => day.id === props.selectedDayId) ?? null;
  const selectedColor = selectedDay ? dayColorFor(props.dayColors, selectedDay.id) : null;

  // Publish the always-visible part of the sheet (peek header + hero row +
  // quick actions) as a CSS variable. Only that part is measured, so the map
  // controls don't leap upward when the sheet expands over them anyway.
  useEffect(() => {
    const node = collapsedRef.current;
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

  // Picking a day on mobile collapses the sheet so the filtered map is visible.
  function handleSelectDay(dayId: string | null) {
    props.onSelectDay(dayId);
    setExpanded(false);
  }

  // The peek header doubles as a day swiper: a horizontal swipe steps the day
  // filter. The 1.5x dominance check keeps diagonal sheet-drag gestures from
  // also flipping the day, and short swipes (< 48px) are ignored as taps.
  function handleTouchStart(event: React.TouchEvent) {
    touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const deltaX = event.changedTouches[0].clientX - start.x;
    const deltaY = event.changedTouches[0].clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;
    // Swiping left pulls the next day into view, like paging through cards.
    props.onStepDay(deltaX < 0 ? 1 : -1);
  }

  return (
    <div className="md:hidden">
      {/* Scrim dims the map while the sheet is open; tap to collapse. */}
      <div
        className={cn(
          "fixed inset-0 z-20 bg-stone-950/30 backdrop-blur-[1px] transition-opacity duration-300",
          expanded ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setExpanded(false)}
        aria-hidden
      />

      <div className="fixed inset-x-0 bottom-0 z-30">
        <div className="mx-3 mb-[calc(0.75rem+env(safe-area-inset-bottom))] overflow-hidden rounded-panel border border-stone-200/80 bg-paper/96 text-stone-950 shadow-[0_-12px_60px_rgba(46,61,54,0.28)] backdrop-blur-xl">
          <div ref={collapsedRef}>
          {/* Grab handle + peek header — tap to toggle, swipe sideways or use the
              chevrons to step through days. */}
          <div
            className="relative flex w-full items-center gap-1 px-2 pb-2 pt-3.5"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <span className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-stone-300" aria-hidden />
            <button
              type="button"
              onClick={() => props.onStepDay(-1)}
              aria-label="Previous day"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-900/5 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20 active:scale-[0.95]"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              aria-expanded={expanded}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-800/80">
                  {selectedColor ? <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: selectedColor }} /> : null}
                  <span className="truncate">{dayLabel(selectedDay)}</span>
                </span>
                <span className="block truncate font-bold text-stone-950">{props.mapAvailable === false ? "Map unavailable" : countsLabel(props.counts)}</span>
              </span>
              <ChevronUp className={cn("h-5 w-5 shrink-0 text-stone-500 transition-transform duration-300", expanded && "rotate-180")} />
            </button>
            <button
              type="button"
              onClick={() => props.onStepDay(1)}
              aria-label="Next day"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-900/5 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20 active:scale-[0.95]"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Position dots: one per entry in ["All days", day 1, …]. They make the
              hidden swipe gesture legible — this is a pager — and show where
              you are in it. Purely visual; the chevrons are the controls. */}
          {props.days.length > 0 ? (
            <div aria-hidden className="flex items-center justify-center gap-1.5 pb-2">
              {[null, ...props.days].map((day) => {
                const active = (day?.id ?? null) === props.selectedDayId;
                const color = day ? dayColorFor(props.dayColors, day.id) : "#57534e";
                return (
                  <span
                    key={day?.id ?? "all"}
                    className={cn("h-1.5 rounded-full transition-all duration-200", active ? "w-4" : "w-1.5 opacity-40")}
                    style={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          ) : null}

          {/* Collapsed: a single slim row keeps Relive one tap away without
              the full hero card eating a quarter of the screen. The full card
              (with its photo preview) lives in the expanded region. */}
          <div className="space-y-2 px-3 pb-3">
            {props.journey && !expanded ? (
              <button
                type="button"
                onClick={props.journey.onPlay}
                disabled={props.journey.disabled}
                className="flex w-full items-center gap-3 rounded-xl bg-[#0f3b32] px-3 py-2 text-left text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-400 text-stone-950"><Play className="h-4 w-4 fill-current" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{props.journey.day ? `Relive Day ${props.journey.day.day_number}` : "Relive the journey"}</span>
                  <span className="block truncate text-[11px] text-white/75">
                    {props.journey.momentCount > 0 ? `${props.journey.momentCount} moment${props.journey.momentCount === 1 ? "" : "s"}` : "Watch the trip unfold"}
                    {props.journey.day?.title ? ` · ${props.journey.day.title}` : ""}
                  </span>
                </span>
              </button>
            ) : null}
            <QuickActions onStartPhotoUpload={props.onStartPhotoUpload} onStartAddNote={props.onStartAddNote} onStartRouteDraw={props.onStartRouteDraw} />
          </div>
          </div>

          {/* Expandable region animates via grid-template-rows 0fr -> 1fr. */}
          <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
            <div className="overflow-hidden">
              {expanded ? (
                <div className="max-h-[58dvh] space-y-4 overflow-y-auto px-4 pb-4">
                  {props.journey ? (
                    <JourneyHeroCard
                      photos={props.journey.photos}
                      momentCount={props.journey.momentCount}
                      dayCount={props.journey.dayCount}
                      day={props.journey.day}
                      onPlay={props.journey.onPlay}
                      disabled={props.journey.disabled}
                      compact
                    />
                  ) : null}
                  {props.trip?.description ? <p className="text-sm leading-6 text-stone-600">{props.trip.description}</p> : null}
                  {props.days.length === 0 && props.trip === null ? (
                    <DayListSkeleton />
                  ) : (
                    <DayList days={props.days} dayStats={props.dayStats} dayColors={props.dayColors} selectedDayId={props.selectedDayId} onSelectDay={handleSelectDay} onStepDay={props.onStepDay} onPlayDay={props.journey?.onPlayDay} showStepButtons={false} />
                  )}
                  {props.showLayerControls !== false ? <LayersPanel layerVisibility={props.layerVisibility} onLayerVisibilityChange={props.onLayerVisibilityChange} /> : null}
                  {props.notesPlaces ? <NotesPlacesList {...props.notesPlaces} /> : null}
                  {props.adminData ? <AdminDataPanel {...props.adminData} /> : null}
                  {props.memberAdmin ? <MemberAdminPanel {...props.memberAdmin} /> : null}
                  {props.adminRequest ? <AdminRequestPanel {...props.adminRequest} /> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
