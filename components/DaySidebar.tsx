"use client";

import { CalendarDays, Camera, FileText, Map, Mountain, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Day } from "@/types/trip";

type Props = {
  days: Day[];
  selectedDayId: string | null;
  onSelectDay: (dayId: string | null) => void;
  layerVisibility: { photos: boolean; notes: boolean; routes: boolean };
  onLayerVisibilityChange: (next: { photos: boolean; notes: boolean; routes: boolean }) => void;
  onStartPhotoUpload: () => void;
  onStartAddNote: () => void;
};

export function DaySidebar({ days, selectedDayId, onSelectDay, layerVisibility, onLayerVisibilityChange, onStartPhotoUpload, onStartAddNote }: Props) {
  return (
    <aside className="flex max-h-[78dvh] flex-col gap-4 overflow-y-auto rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.94)] p-4 text-stone-950 shadow-[0_24px_80px_rgba(46,61,54,0.2)] backdrop-blur-xl md:h-full md:max-h-none md:w-96 md:p-5">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-700/20 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-900">
          <Mountain className="h-3.5 w-3.5" /> Lofoten 2026
        </div>
        <h1 className="font-serif text-4xl font-semibold leading-none tracking-tight text-stone-950">Lofoten Logbook</h1>
        <p className="max-w-[28rem] text-sm leading-6 text-stone-600">Routes, trail notes, and geotagged memories from a long summer week around Reine and Moskenes.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onStartPhotoUpload} className="rounded-lg bg-[#e7a13d] px-4 py-3 text-sm font-black text-stone-950 shadow-[0_12px_28px_rgba(184,106,31,0.22)] transition hover:bg-[#f0ae4b]">
          <Camera className="mr-2 inline h-4 w-4" /> Upload photo
        </button>
        <button onClick={onStartAddNote} className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-800 transition hover:bg-stone-50">
          <FileText className="mr-2 inline h-4 w-4" /> Add note
        </button>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-stone-900"><CalendarDays className="h-4 w-4 text-teal-700" /> Trip days</div>
        <div className="space-y-2">
          <button onClick={() => onSelectDay(null)} className={cn("w-full rounded-lg border px-4 py-3 text-left transition", selectedDayId === null ? "border-teal-700/35 bg-teal-50 shadow-sm" : "border-stone-200 bg-white/75 hover:bg-white")}>
            <div className="font-bold text-stone-950">All days</div>
            <div className="text-xs text-stone-500">Show the whole adventure</div>
          </button>
          {days.map((day) => (
            <button key={day.id} onClick={() => onSelectDay(day.id)} className={cn("w-full rounded-lg border px-4 py-3 text-left transition", selectedDayId === day.id ? "border-teal-700/35 bg-teal-50 shadow-sm" : "border-stone-200 bg-white/75 hover:bg-white")}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-stone-950">Day {day.day_number}: {day.title ?? "Open trail"}</span>
                {day.date ? <span className="shrink-0 text-xs font-bold text-teal-800">{new Date(day.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}
              </div>
              <div className="mt-1 text-xs leading-5 text-stone-500">{day.summary ?? "Route planning and shared memories."}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-stone-200 bg-white/75 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-stone-900"><Map className="h-4 w-4 text-teal-700" /> Layers</div>
        {([
          ["routes", "Routes", Route],
          ["photos", "Photos", Camera],
          ["notes", "Notes & places", FileText],
        ] as const).map(([key, label, Icon]) => (
          <label key={key} className="flex cursor-pointer items-center justify-between rounded-lg bg-[#f7f1e7] px-3 py-2 text-sm text-stone-800">
            <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-teal-700" /> {label}</span>
            <input type="checkbox" checked={layerVisibility[key]} onChange={(event) => onLayerVisibilityChange({ ...layerVisibility, [key]: event.target.checked })} className="h-4 w-4 accent-teal-700" />
          </label>
        ))}
        <div className="rounded-lg border border-amber-700/15 bg-amber-50 p-3 text-xs leading-5 text-amber-900">3D terrain remains a v2 toggle; this view stays fast for shared photo browsing.</div>
      </section>
    </aside>
  );
}
