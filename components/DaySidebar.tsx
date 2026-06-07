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
    <aside className="flex h-full flex-col gap-5 overflow-y-auto rounded-[2rem] border border-white/15 bg-slate-950/75 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl md:w-96 md:p-5">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">
          <Mountain className="h-3.5 w-3.5" /> Lofoten 2026
        </div>
        <h1 className="text-3xl font-black tracking-tight text-white">Lofoten Logbook</h1>
        <p className="text-sm leading-6 text-slate-300">A collaborative trip journal for routes, trail notes, and geotagged memories around Reine and Moskenes.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onStartPhotoUpload} className="rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-300">
          <Camera className="mr-2 inline h-4 w-4" /> Upload photo
        </button>
        <button onClick={onStartAddNote} className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/15">
          <FileText className="mr-2 inline h-4 w-4" /> Add note
        </button>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white"><CalendarDays className="h-4 w-4 text-cyan-200" /> Trip days</div>
        <div className="space-y-2">
          <button onClick={() => onSelectDay(null)} className={cn("w-full rounded-2xl border px-4 py-3 text-left transition", selectedDayId === null ? "border-cyan-300 bg-cyan-300/15" : "border-white/10 bg-white/5 hover:bg-white/10")}>
            <div className="font-bold text-white">All days</div>
            <div className="text-xs text-slate-400">Show the whole adventure</div>
          </button>
          {days.map((day) => (
            <button key={day.id} onClick={() => onSelectDay(day.id)} className={cn("w-full rounded-2xl border px-4 py-3 text-left transition", selectedDayId === day.id ? "border-cyan-300 bg-cyan-300/15" : "border-white/10 bg-white/5 hover:bg-white/10")}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-bold text-white">Day {day.day_number}: {day.title ?? "Open trail"}</span>
                {day.date ? <span className="text-xs text-cyan-100">{new Date(day.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span> : null}
              </div>
              <div className="mt-1 text-xs text-slate-400">{day.summary ?? "Route planning and shared memories."}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white"><Map className="h-4 w-4 text-cyan-200" /> Layers</div>
        {([
          ["routes", "Routes", Route],
          ["photos", "Photos", Camera],
          ["notes", "Notes & places", FileText],
        ] as const).map(([key, label, Icon]) => (
          <label key={key} className="flex cursor-pointer items-center justify-between rounded-2xl bg-slate-900/70 px-3 py-2 text-sm text-slate-100">
            <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-cyan-200" /> {label}</span>
            <input type="checkbox" checked={layerVisibility[key]} onChange={(event) => onLayerVisibilityChange({ ...layerVisibility, [key]: event.target.checked })} className="h-4 w-4 accent-cyan-300" />
          </label>
        ))}
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-50">3D terrain is intentionally a v2 toggle. The map architecture is ready for Mapbox terrain sources later.</div>
      </section>
    </aside>
  );
}
