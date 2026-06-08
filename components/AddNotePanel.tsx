"use client";

import { Loader2, MapPin, X } from "lucide-react";
import { useState } from "react";
import type { Day, LngLat } from "@/types/trip";

type Props = {
  days: Day[];
  selectedCoordinate: LngLat | null;
  defaultDayId: string | null;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (input: { body: string; authorName: string; dayId: string | null }) => Promise<void>;
};

function noteDraftHint(hasCoordinate: boolean, hasBody: boolean) {
  if (!hasCoordinate && !hasBody) return "Pick a map location and write a note to save it.";
  if (!hasCoordinate) return "Pick a map location to save this note.";
  if (!hasBody) return "Write a note to save this location.";
  return "Note is ready to save.";
}

export function AddNotePanel({ days, selectedCoordinate, defaultDayId, isSaving, onCancel, onSave }: Props) {
  const [body, setBody] = useState("");
  const hasBody = body.trim().length > 0;
  const hasCoordinate = Boolean(selectedCoordinate);

  async function submit(formData: FormData) {
    await onSave({
      body: body.trim(),
      authorName: String(formData.get("authorName") ?? "").trim(),
      dayId: String(formData.get("dayId") || "") || null,
    });
  }

  return (
    <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.96)] text-stone-950 shadow-[0_24px_80px_rgba(46,61,54,0.22)] backdrop-blur-xl md:bottom-6 md:left-auto md:right-6 md:w-96">
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-semibold tracking-tight">Add a trail note</h2>
            <p className="mt-1 text-sm leading-5 text-stone-600">Tap the map to choose a location, then save a short note.</p>
          </div>
          <button onClick={onCancel} className="rounded-full p-2 text-stone-500 hover:bg-stone-900/5" aria-label="Close note panel"><X className="h-4 w-4" /></button>
        </div>
        <form action={submit} className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className="rounded-lg border border-teal-700/25 bg-teal-50 p-3 text-sm text-teal-950">
            <MapPin className="mr-2 inline h-4 w-4" />
            {selectedCoordinate ? `${selectedCoordinate.lat.toFixed(5)}, ${selectedCoordinate.lng.toFixed(5)}` : "No coordinate yet. Click or tap the map."}
          </div>
          <textarea name="body" required maxLength={240} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Describe the viewpoint, camp spot, weather, or inside joke..." className="min-h-24 w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
          <div aria-live="polite" className="rounded-lg border border-teal-700/15 bg-teal-50 px-3 py-2 text-xs font-semibold leading-5 text-teal-950">
            {noteDraftHint(hasCoordinate, hasBody)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input name="authorName" placeholder="Your name" className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
            <select name="dayId" defaultValue={defaultDayId ?? ""} className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
              <option value="">All days</option>
              {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
            </select>
          </div>
          <button disabled={!hasCoordinate || !hasBody || isSaving} className="w-full rounded-lg bg-[#e7a13d] px-4 py-3 font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
            {isSaving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null} Save note
          </button>
        </form>
      </div>
    </div>
  );
}
