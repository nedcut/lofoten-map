"use client";

import { ChevronUp } from "lucide-react";
import { useState } from "react";
import { AdminDataPanel } from "@/components/AdminDataPanel";
import { DayList, LayersPanel, MemberAdminPanel, QuickActions, type SidebarProps } from "@/components/DaySidebar";
import { cn } from "@/lib/utils";
import type { Day } from "@/types/trip";

// Counts for the current map filter, so the collapsed peek can tell you what's
// pinned without expanding the sheet. Notes and places share a marker layer, so
// they're summed together under "notes".
export type PeekCounts = { photos: number; notes: number; places: number };

type MobileSheetProps = SidebarProps & { counts: PeekCounts };

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// The label line: which slice of the trip the map is showing.
function dayLabel(selectedDay: Day | null): string {
  if (!selectedDay) return "All days";
  return `Day ${selectedDay.day_number}${selectedDay.title ? `: ${selectedDay.title}` : ""}`;
}

// The prominent line: how much is on the map right now. Tweak to taste — e.g.
// add routes, or change the empty-state copy.
function countsLabel(counts: PeekCounts): string {
  const notes = counts.notes + counts.places;
  const parts = [];
  if (counts.photos) parts.push(pluralize(counts.photos, "photo"));
  if (notes) parts.push(pluralize(notes, "note"));
  return parts.length > 0 ? parts.join(" · ") : "No pins on the map yet";
}

export function MobileSheet(props: MobileSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const selectedDay = props.days.find((day) => day.id === props.selectedDayId) ?? null;

  // Picking a day on mobile collapses the sheet so the filtered map is visible.
  function handleSelectDay(dayId: string | null) {
    props.onSelectDay(dayId);
    setExpanded(false);
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
          {/* Grab handle + peek header — tap anywhere to toggle. */}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="relative flex w-full items-center gap-3 px-4 pb-3 pt-3.5 text-left"
            aria-expanded={expanded}
          >
            <span className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-stone-300" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-800/80">{dayLabel(selectedDay)}</span>
              <span className="block truncate font-bold text-stone-950">{countsLabel(props.counts)}</span>
            </span>
            <ChevronUp className={cn("h-5 w-5 shrink-0 text-stone-500 transition-transform duration-300", expanded && "rotate-180")} />
          </button>

          {/* Quick actions stay reachable even when collapsed. */}
          <div className="px-4 pb-3">
            <QuickActions onStartPhotoUpload={props.onStartPhotoUpload} onStartAddNote={props.onStartAddNote} onStartRouteDraw={props.onStartRouteDraw} />
          </div>

          {/* Expandable region animates via grid-template-rows 0fr -> 1fr. */}
          <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
            <div className="overflow-hidden">
              <div className="max-h-[58dvh] space-y-4 overflow-y-auto px-4 pb-4">
                <DayList days={props.days} selectedDayId={props.selectedDayId} onSelectDay={handleSelectDay} />
                <LayersPanel layerVisibility={props.layerVisibility} onLayerVisibilityChange={props.onLayerVisibilityChange} />
                {props.adminData ? <AdminDataPanel {...props.adminData} /> : null}
                {props.memberAdmin ? <MemberAdminPanel {...props.memberAdmin} /> : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
