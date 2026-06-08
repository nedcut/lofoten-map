"use client";

import { Loader2, MapPin, RotateCcw, Route, Save, Undo2, X } from "lucide-react";
import type { Day, LngLat, RouteMode } from "@/types/trip";

type Props = {
  days: Day[];
  defaultDayId: string | null;
  points: LngLat[];
  distanceMeters: number;
  isSaving: boolean;
  onCancel: () => void;
  onUndoPoint: () => void;
  onClear: () => void;
  onSave: (input: { name: string; dayId: string | null; mode: RouteMode }) => Promise<void>;
};

const routeModes: Array<{ value: RouteMode; label: string }> = [
  { value: "hike", label: "Hike" },
  { value: "walk", label: "Walk" },
  { value: "ferry", label: "Ferry" },
  { value: "bus", label: "Bus" },
  { value: "other", label: "Other" },
];

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function routeDraftHint(pointCount: number) {
  if (pointCount === 0) return "Add at least 2 points on the map to save a route.";
  if (pointCount === 1) return "Add 1 more point to make this a saveable route.";
  return "Route is ready to save. Add more points to refine the path.";
}

export function ManualRoutePanel({ days, defaultDayId, points, distanceMeters, isSaving, onCancel, onUndoPoint, onClear, onSave }: Props) {
  async function submit(formData: FormData) {
    await onSave({
      name: String(formData.get("name") ?? "").trim(),
      dayId: String(formData.get("dayId") || "") || null,
      mode: String(formData.get("mode") || "hike") as RouteMode,
    });
  }

  return (
    <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.96)] text-stone-950 shadow-[0_24px_80px_rgba(46,61,54,0.22)] backdrop-blur-xl md:bottom-6 md:left-auto md:right-6 md:w-96">
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-semibold tracking-tight">Draw route</h2>
            <p className="mt-1 text-sm leading-5 text-stone-600">Tap the map to place route points in order, then save it to a trip day.</p>
          </div>
          <button onClick={onCancel} className="rounded-full p-2 text-stone-500 hover:bg-stone-900/5" aria-label="Close route editor"><X className="h-4 w-4" /></button>
        </div>

        <form action={submit} className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2 text-center text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
            <div className="rounded-lg border border-teal-700/20 bg-teal-50 px-3 py-2 text-teal-950">
              <Route className="mx-auto mb-1 h-4 w-4" />
              <span className="block text-base text-teal-950">{points.length}</span>
              Points
            </div>
            <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-600">
              <MapPin className="mx-auto mb-1 h-4 w-4 text-teal-700" />
              <span className="block text-base text-stone-950">{formatDistance(distanceMeters)}</span>
              Distance
            </div>
          </div>

          <input name="name" placeholder="Route name" className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />

          <div aria-live="polite" className="rounded-lg border border-teal-700/15 bg-teal-50 px-3 py-2 text-xs font-semibold leading-5 text-teal-950">
            {routeDraftHint(points.length)}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select name="dayId" defaultValue={defaultDayId ?? ""} className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
              <option value="">All days</option>
              {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
            </select>
            <select name="mode" defaultValue="hike" className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
              {routeModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-[auto_auto_1fr] gap-2">
            <button type="button" onClick={onUndoPoint} disabled={points.length === 0 || isSaving} className="rounded-lg border border-stone-300 bg-white px-3 text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45" aria-label="Undo route point">
              <Undo2 className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClear} disabled={points.length === 0 || isSaving} className="rounded-lg border border-stone-300 bg-white px-3 text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45" aria-label="Clear route draft">
              <RotateCcw className="h-4 w-4" />
            </button>
            <button disabled={points.length < 2 || isSaving} className="rounded-lg bg-[#e7a13d] px-4 py-3 text-sm font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
              {isSaving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <Save className="mr-2 inline h-4 w-4" />} Save route
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
