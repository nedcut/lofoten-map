"use client";

import { Camera, Loader2, MapPin, Upload, X } from "lucide-react";
import { extractPhotoExif, type ExtractedExif } from "@/lib/exif";
import type { Day, LngLat } from "@/types/trip";

type Props = {
  days: Day[];
  defaultDayId: string | null;
  pendingCoordinate: LngLat | null;
  exif: ExtractedExif | null;
  fileName: string | null;
  isSaving: boolean;
  onCancel: () => void;
  onExifRead: (file: File, exif: ExtractedExif) => void;
  onSave: (input: { file: File; caption: string; uploaderName: string; dayId: string | null }) => Promise<void>;
};

const MAX_FILE_SIZE = 12 * 1024 * 1024;

export function UploadPhotoPanel({ days, defaultDayId, pendingCoordinate, exif, fileName, isSaving, onCancel, onExifRead, onSave }: Props) {
  async function handleFile(form: HTMLFormElement, file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      form.reset();
      alert("Please choose an image file.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      form.reset();
      alert("Please choose an image under 12 MB for the MVP upload flow.");
      return;
    }
    onExifRead(file, await extractPhotoExif(file));
  }

  async function submit(formData: FormData) {
    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) return;
    await onSave({
      file,
      caption: String(formData.get("caption") ?? "").trim(),
      uploaderName: String(formData.get("uploaderName") ?? "").trim(),
      dayId: String(formData.get("dayId") || "") || null,
    });
  }

  return (
    <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-30 rounded-[1.75rem] border border-white/15 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur-xl md:bottom-6 md:left-auto md:right-6 md:w-[28rem]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black">Upload a photo</h2>
          <p className="text-sm text-slate-300">We will read GPS from EXIF when available. If it is missing, tap the map.</p>
        </div>
        <button onClick={onCancel} className="rounded-full p-2 text-slate-300 hover:bg-white/10"><X className="h-4 w-4" /></button>
      </div>
      <form action={submit} className="space-y-3">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-cyan-200/40 bg-cyan-300/10 px-4 py-4 text-sm font-bold text-cyan-50 hover:bg-cyan-300/15">
          <Camera className="h-4 w-4" /> {fileName ?? "Choose image"}
          <input name="photo" type="file" accept="image/*" required className="hidden" onChange={(event) => handleFile(event.currentTarget.form!, event.target.files?.[0])} />
        </label>
        {exif ? <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm leading-6 text-slate-200">{exif.message}{exif.takenAt ? <><br />Taken: {new Date(exif.takenAt).toLocaleString("en-US")}</> : null}</div> : null}
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-50">
          <MapPin className="mr-2 inline h-4 w-4" />
          {pendingCoordinate ? `${pendingCoordinate.lat.toFixed(5)}, ${pendingCoordinate.lng.toFixed(5)}` : "Waiting for EXIF GPS or manual map placement."}
        </div>
        <textarea name="caption" maxLength={280} placeholder="Caption" className="min-h-20 w-full rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm outline-none ring-cyan-300/40 placeholder:text-slate-500 focus:ring-4" />
        <div className="grid grid-cols-2 gap-2">
          <input name="uploaderName" placeholder="Your name" className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-cyan-300/40" />
          <select name="dayId" defaultValue={defaultDayId ?? ""} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-cyan-300/40">
            <option value="">All days</option>
            {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
          </select>
        </div>
        <button disabled={!pendingCoordinate || isSaving} className="w-full rounded-2xl bg-cyan-400 px-4 py-3 font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
          {isSaving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <Upload className="mr-2 inline h-4 w-4" />} Upload photo
        </button>
      </form>
    </div>
  );
}
