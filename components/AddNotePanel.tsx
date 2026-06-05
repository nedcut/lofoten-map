"use client";

import { Loader2, MapPin, X } from "lucide-react";
import type { Day, LngLat } from "@/types/trip";

type Props = {
  days: Day[];
  selectedCoordinate: LngLat | null;
  defaultDayId: string | null;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (input: { body: string; authorName: string; dayId: string | null }) => Promise<void>;
};

export function AddNotePanel({ days, selectedCoordinate, defaultDayId, isSaving, onCancel, onSave }: Props) {
  async function submit(formData: FormData) {
    await onSave({
      body: String(formData.get("body") ?? "").trim(),
      authorName: String(formData.get("authorName") ?? "").trim(),
      dayId: String(formData.get("dayId") || "") || null,
    });
  }

  return (
    <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-30 rounded-[1.75rem] border border-white/15 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl md:bottom-6 md:left-auto md:right-6 md:w-96">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">Add a trail note</h2>
          <p className="text-sm text-slate-300">Tap the map to choose a location, then save a short note.</p>
        </div>
        <button onClick={onCancel} className="rounded-full p-2 text-slate-300 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      <form action={submit} className="space-y-3">
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-50">
          <MapPin className="mr-2 inline h-4 w-4" />
          {selectedCoordinate ? `${selectedCoordinate.lat.toFixed(5)}, ${selectedCoordinate.lng.toFixed(5)}` : "No coordinate yet. Click or tap the map."}
        </div>
        <textarea name="body" required maxLength={240} placeholder="Describe the viewpoint, camp spot, weather, or inside joke..." className="min-h-24 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm outline-none ring-cyan-300/40 placeholder:text-slate-500 focus:ring-4" />
        <div className="grid grid-cols-2 gap-2">
          <input name="authorName" placeholder="Your name" className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-cyan-300/40" />
          <select name="dayId" defaultValue={defaultDayId ?? ""} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-cyan-300/40">
            <option value="">All days</option>
            {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
          </select>
        </div>
        <button disabled={!selectedCoordinate || isSaving} className="w-full rounded-2xl bg-cyan-400 px-4 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
          {isSaving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null} Save note
        </button>
      </form>
    </div>
  );
}
