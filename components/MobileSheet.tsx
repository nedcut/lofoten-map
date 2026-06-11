"use client";

import { ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { useRef, useState } from "react";
import { AdminDataPanel } from "@/components/AdminDataPanel";
import { AdminRequestPanel, DayList, LayersPanel, MemberAdminPanel, QuickActions, SidebarHeader, type SidebarProps } from "@/components/DaySidebar";
import { cn } from "@/lib/utils";
import type { Day } from "@/types/trip";

// Counts for the current map filter, so the collapsed peek can tell you what's
// visible without expanding the sheet. Notes and places share a marker layer, so
// they're summed together as journal pins.
export type PeekCounts = { routes: number; photos: number; notes: number; places: number };

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
  if (counts.photos) parts.push(`${counts.photos} media`);
  if (journalPins) parts.push(pluralize(journalPins, "pin"));
  return parts.length > 0 ? parts.join(" · ") : "Nothing on the map yet";
}

export function MobileSheet(props: MobileSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const selectedDay = props.days.find((day) => day.id === props.selectedDayId) ?? null;

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
        <div className="mx-3 mb-3 overflow-hidden rounded-[1.4rem] border border-stone-200/80 bg-[rgba(255,253,246,0.96)] text-stone-950 shadow-[0_-12px_60px_rgba(46,61,54,0.28)] backdrop-blur-xl">
          {/* Grab handle + peek header — tap to toggle, swipe sideways or use the
              chevrons to step through days. */}
          <div
            className="relative flex w-full items-center gap-1 px-2 pb-3 pt-3.5"
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
                <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-800/80">{dayLabel(selectedDay)}</span>
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

          {/* Quick actions stay reachable even when collapsed. */}
          <div className="px-4 pb-3">
            <QuickActions onStartPhotoUpload={props.onStartPhotoUpload} onStartAddNote={props.onStartAddNote} onStartRouteDraw={props.onStartRouteDraw} />
          </div>

          {/* Expandable region animates via grid-template-rows 0fr -> 1fr. */}
          <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
            <div className="overflow-hidden">
              {expanded ? (
                <div className="max-h-[58dvh] space-y-4 overflow-y-auto px-4 pb-4">
                  <SidebarHeader trip={props.trip} compact />
                  <DayList days={props.days} dayStats={props.dayStats} selectedDayId={props.selectedDayId} onSelectDay={handleSelectDay} onStepDay={props.onStepDay} />
                  {props.showLayerControls !== false ? <LayersPanel layerVisibility={props.layerVisibility} onLayerVisibilityChange={props.onLayerVisibilityChange} /> : null}
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
