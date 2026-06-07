"use client";

import { useState } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LayerVisibility } from "@/components/DaySidebar";

// Legend entries map 1:1 to the layer colors defined in TripLayers. Keep the
// swatch colors in sync with the paint properties there.
const ENTRIES: Array<{ key: keyof LayerVisibility; label: string; swatch: string }> = [
  { key: "routes", label: "Routes", swatch: "bg-[#0f766e]" },
  { key: "photos", label: "Photos", swatch: "bg-[#fffdf6] ring-2 ring-[#e7a13d]" },
  { key: "notes", label: "Notes", swatch: "bg-[#f6d28f] ring-2 ring-[#7c4a14]/60" },
  { key: "notes", label: "Places", swatch: "bg-[#c8e4d4] ring-2 ring-[#0f5f55]/60" },
];

export function MapLegend({ visibility }: { visibility: LayerVisibility }) {
  const [open, setOpen] = useState(false);
  const visible = ENTRIES.filter((entry) => visibility[entry.key]);
  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 hidden sm:block">
      <div className="overflow-hidden rounded-xl border border-stone-200/80 bg-[rgba(255,253,246,0.92)] shadow-[0_12px_30px_rgba(46,61,54,0.18)] backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-stone-700 transition hover:bg-white/60"
          aria-expanded={open}
        >
          <Layers className="h-3.5 w-3.5 text-teal-700" /> Legend
          <ChevronDown className={cn("ml-1 h-3.5 w-3.5 text-stone-400 transition-transform duration-200", open && "rotate-180")} />
        </button>
        <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="overflow-hidden">
            <div className="space-y-1.5 px-3 pb-3">
              {visible.map((entry) => (
                <div key={entry.label} className="flex items-center gap-2 text-xs text-stone-700">
                  <span className={cn("h-3 w-3 shrink-0 rounded-full", entry.swatch)} />
                  {entry.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
