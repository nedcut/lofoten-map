"use client";

import { Camera, CheckCircle2, FileImage, Images, Loader2, MapPin, RotateCcw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { extractPhotoExif, type ExtractedExif } from "@/lib/exif";
import { cn } from "@/lib/utils";
import type { Day, LngLat } from "@/types/trip";

export type PhotoUploadItemInput = {
  clientId: string;
  file: File;
  caption: string;
  uploaderName: string;
  dayId: string | null;
  coordinate: LngLat;
  exif: ExtractedExif | null;
};

type Props = {
  days: Day[];
  defaultDayId: string | null;
  pendingCoordinate: LngLat | null;
  isSaving: boolean;
  onCancel: () => void;
  onCoordinatePreview: (coordinate: LngLat | null) => void;
  onSave: (items: PhotoUploadItemInput[]) => Promise<void>;
};

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const EXIF_CONCURRENCY = 4;
const IMAGE_EXTENSIONS = [".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".gif"];

type QueueStatus = "reading" | "ready" | "needs-location" | "invalid" | "uploaded";

type QueueItem = {
  id: string;
  file: File;
  caption: string;
  exif: ExtractedExif | null;
  coordinate: LngLat | null;
  status: QueueStatus;
  message: string;
};

function isSupportedImage(file: File) {
  const lowerName = file.name.toLowerCase();
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function mapWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const next = items[index++];
      await worker(next);
    }
  });
  await Promise.all(runners);
}

export function UploadPhotoPanel({ days, defaultDayId, pendingCoordinate, isSaving, onCancel, onCoordinatePreview, onSave }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [uploaderName, setUploaderName] = useState("");
  const [dayId, setDayId] = useState(defaultDayId ?? "");
  const activeItem = items.find((item) => item.id === activeItemId) ?? items[0] ?? null;
  const activePreviewUrl = useMemo(() => activeItem ? URL.createObjectURL(activeItem.file) : null, [activeItem]);

  useEffect(() => () => {
    if (activePreviewUrl) URL.revokeObjectURL(activePreviewUrl);
  }, [activePreviewUrl]);

  useEffect(() => {
    if (activeItem?.coordinate) onCoordinatePreview(activeItem.coordinate);
    else if (activeItem?.status === "needs-location") onCoordinatePreview(null);
  }, [activeItem?.coordinate, activeItem?.id, activeItem?.status, onCoordinatePreview]);

  useEffect(() => {
    if (!pendingCoordinate || !activeItemId) return;
    setItems((current) => current.map((item) => item.id === activeItemId && item.status === "needs-location"
      ? { ...item, coordinate: pendingCoordinate, status: "ready", message: "Location set from the map." }
      : item));
  }, [activeItemId, pendingCoordinate]);

  const counts = useMemo(() => ({
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    needsLocation: items.filter((item) => item.status === "needs-location").length,
    reading: items.filter((item) => item.status === "reading").length,
    invalid: items.filter((item) => item.status === "invalid").length,
  }), [items]);

  async function handleFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;

    const nextItems: QueueItem[] = selected.map((file) => {
      const id = crypto.randomUUID();
      if (!isSupportedImage(file)) {
        return { id, file, caption: "", exif: null, coordinate: null, status: "invalid", message: "Unsupported file type." };
      }
      if (file.size > MAX_FILE_SIZE) {
        return { id, file, caption: "", exif: null, coordinate: null, status: "invalid", message: `Over ${formatBytes(MAX_FILE_SIZE)}. Export a smaller copy first.` };
      }
      return { id, file, caption: "", exif: null, coordinate: null, status: "reading", message: "Reading photo metadata..." };
    });

    setItems((current) => [...current, ...nextItems]);
    setActiveItemId((current) => current && items.some((item) => item.id === current) ? current : nextItems[0]?.id ?? null);

    const readable = nextItems.filter((item) => item.status === "reading");
    await mapWithConcurrency(readable, EXIF_CONCURRENCY, async (item) => {
      const exif = await extractPhotoExif(item.file);
      setItems((current) => current.map((currentItem) => {
        if (currentItem.id !== item.id) return currentItem;
        const coordinate = exif.lat !== null && exif.lng !== null ? { lat: exif.lat, lng: exif.lng } : null;
        return {
          ...currentItem,
          exif,
          coordinate,
          status: coordinate ? "ready" : "needs-location",
          message: exif.message,
        };
      }));
    });
  }

  async function submit(formData: FormData) {
    const readyItems = items.filter((item) => item.status === "ready" && item.coordinate);
    if (readyItems.length === 0) return;
    await onSave(readyItems.map((item) => ({
      clientId: item.id,
      file: item.file,
      caption: item.caption,
      uploaderName: String(formData.get("uploaderName") ?? "").trim(),
      dayId: String(formData.get("dayId") || "") || null,
      coordinate: item.coordinate!,
      exif: item.exif,
    })));
  }

  return (
    <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.4rem] border border-stone-200/80 bg-[rgba(255,253,246,0.96)] text-stone-950 shadow-[0_24px_80px_rgba(46,61,54,0.22)] backdrop-blur-xl md:bottom-6 md:left-auto md:right-6 md:w-[30rem]">
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col p-4 md:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-semibold tracking-tight text-stone-950">Upload photo</h2>
          <p className="mt-1 text-sm leading-5 text-stone-600">Choose one shot or a whole camera roll batch. GPS is read locally before upload.</p>
        </div>
        <button onClick={onCancel} className="rounded-full p-2 text-stone-500 hover:bg-stone-900/5" aria-label="Close upload panel"><X className="h-4 w-4" /></button>
      </div>

      <form action={submit} className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-teal-700/35 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-950 transition hover:bg-teal-100">
            <Images className="h-4 w-4" /> Choose from camera roll
            <input name="photo" type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
          </label>
          <label className="flex min-h-14 cursor-pointer items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-stone-700 transition hover:bg-stone-50" title="Browse files from a digital camera or computer export">
            <FileImage className="h-4 w-4" />
            <input type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
          </label>
        </div>

        {items.length > 0 ? (
          <div className="grid grid-cols-4 gap-2 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-stone-500">
            <div className="rounded-md bg-stone-100 px-2 py-2"><span className="block text-sm text-stone-950">{counts.total}</span>Total</div>
            <div className="rounded-md bg-emerald-50 px-2 py-2 text-emerald-800"><span className="block text-sm">{counts.ready}</span>Ready</div>
            <div className="rounded-md bg-amber-50 px-2 py-2 text-amber-800"><span className="block text-sm">{counts.needsLocation}</span>Place</div>
            <div className="rounded-md bg-rose-50 px-2 py-2 text-rose-800"><span className="block text-sm">{counts.invalid}</span>Issues</div>
          </div>
        ) : null}

        {activeItem ? (
          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 rounded-lg border border-stone-200 bg-white p-2 shadow-sm">
            <div className="h-28 overflow-hidden rounded-md bg-stone-100">
              {activePreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Object URLs from local files cannot be optimized by next/image.
                <img src={activePreviewUrl} alt="" className="h-full w-full object-cover" />
              ) : <div className="flex h-full items-center justify-center text-stone-400"><Camera className="h-5 w-5" /></div>}
            </div>
            <div className="min-w-0 py-1">
              <div className="truncate text-sm font-bold text-stone-950">{activeItem.file.name}</div>
              <div className="mt-1 text-xs text-stone-500">{formatBytes(activeItem.file.size)}</div>
              <div className={cn("mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-5", activeItem.status === "ready" ? "bg-emerald-50 text-emerald-900" : activeItem.status === "needs-location" ? "bg-amber-50 text-amber-900" : activeItem.status === "invalid" ? "bg-rose-50 text-rose-900" : "bg-stone-100 text-stone-700")}>
                {activeItem.status === "reading" ? <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin" /> : activeItem.status === "ready" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5" /> : <MapPin className="mt-0.5 h-3.5 w-3.5" />}
                <span>{activeItem.message}{activeItem.exif?.takenAt ? <> Taken {new Date(activeItem.exif.takenAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.</> : null}</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-stone-200 bg-white/80 p-2">
          {items.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center text-center text-sm leading-6 text-stone-500">
              <Camera className="mb-2 h-5 w-5 text-teal-700" />
              Select iPhone camera roll photos, Android images, or exported camera files.
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item, index) => (
                <button type="button" key={item.id} onClick={() => setActiveItemId(item.id)} className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left transition", activeItemId === item.id ? "bg-teal-50 ring-1 ring-teal-700/30" : "hover:bg-stone-100")}>
                  <span className="text-xs font-bold text-stone-400">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-stone-900">{item.file.name}</span>
                    <span className="block truncate text-[11px] text-stone-500">{item.status === "ready" ? "Ready to upload" : item.status === "needs-location" ? "Tap map to place" : item.status === "reading" ? "Reading metadata" : item.message}</span>
                  </span>
                  <span className={cn("h-2.5 w-2.5 rounded-full", item.status === "ready" ? "bg-emerald-500" : item.status === "needs-location" ? "bg-amber-500" : item.status === "invalid" ? "bg-rose-500" : "bg-stone-300")} />
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="rounded-lg border border-teal-700/25 bg-teal-50 px-3 py-2 text-sm text-teal-950">
          <MapPin className="mr-2 inline h-4 w-4" />
          {activeItem?.coordinate ? `${activeItem.coordinate.lat.toFixed(5)}, ${activeItem.coordinate.lng.toFixed(5)}` : activeItem?.status === "needs-location" ? "Tap the map to place the selected photo." : "GPS coordinates appear here when available."}
        </label>

        <textarea value={activeItem?.caption ?? ""} onChange={(event) => {
          const value = event.target.value;
          if (!activeItem) return;
          setItems((current) => current.map((item) => item.id === activeItem.id ? { ...item, caption: value } : item));
        }} maxLength={280} placeholder="Caption for selected photo" className="min-h-16 w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
        <div className="grid grid-cols-2 gap-2">
          <input name="uploaderName" value={uploaderName} onChange={(event) => setUploaderName(event.target.value)} placeholder="Your name" className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
          <select name="dayId" value={dayId} onChange={(event) => setDayId(event.target.value)} className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
            <option value="">All days</option>
            {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button type="button" onClick={() => { setItems([]); setActiveItemId(null); onCoordinatePreview(null); }} disabled={items.length === 0 || isSaving} className="rounded-lg border border-stone-300 bg-white px-3 text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45" aria-label="Clear queue"><RotateCcw className="h-4 w-4" /></button>
          <button disabled={counts.ready === 0 || counts.reading > 0 || isSaving} className="rounded-lg bg-[#e7a13d] px-4 py-3 text-sm font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition hover:bg-[#f0ae4b] disabled:cursor-not-allowed disabled:opacity-50">
            {isSaving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <Upload className="mr-2 inline h-4 w-4" />} Upload {counts.ready > 1 ? `${counts.ready} photos` : "photo"}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
