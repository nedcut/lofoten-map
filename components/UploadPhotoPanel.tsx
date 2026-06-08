"use client";

import { AlertTriangle, Camera, CheckCircle2, FileImage, Images, Loader2, MapPin, RotateCcw, Upload, X } from "lucide-react";
import { along, length as turfLength, lineString, point, pointToLineDistance } from "@turf/turf";
import { useEffect, useMemo, useRef, useState } from "react";
import { extractPhotoExif, type ExtractedExif } from "@/lib/exif";
import { cn } from "@/lib/utils";
import type { LineString } from "geojson";
import type { Day, LngLat, RouteSegment } from "@/types/trip";

export type PhotoUploadItemInput = {
  clientId: string;
  file: File;
  caption: string;
  uploaderName: string;
  dayId: string | null;
  coordinate: LngLat;
  exif: ExtractedExif | null;
};

export type PhotoUploadSaveResult = {
  savedClientIds: string[];
  failedClientIds: string[];
};

type Props = {
  days: Day[];
  routes: RouteSegment[];
  defaultDayId: string | null;
  pendingCoordinate: LngLat | null;
  isSaving: boolean;
  onCancel: () => void;
  onCoordinatePreview: (coordinate: LngLat | null) => void;
  onSave: (items: PhotoUploadItemInput[]) => Promise<PhotoUploadSaveResult | void>;
};

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const EXIF_CONCURRENCY = 4;
const IMAGE_EXTENSIONS = [".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".gif"];
const BATCH_OVERRIDE_IDLE = "__idle";
const ALL_DAYS_VALUE = "__all";

type QueueStatus = "reading" | "ready" | "needs-location" | "invalid";
type QueueFilter = "all" | "review" | "needs-location" | "invalid";

type QueueItem = {
  id: string;
  file: File;
  caption: string;
  dayId: string | null;
  dayMatchSource: "date" | "route" | null;
  locationSource: "gps" | "route" | "manual" | null;
  exif: ExtractedExif | null;
  coordinate: LngLat | null;
  status: QueueStatus;
  message: string;
};

type AnalyzedItem = Pick<QueueItem, "id" | "dayId" | "dayMatchSource" | "locationSource" | "exif" | "coordinate" | "status" | "message"> & {
  order: number;
};

function isSupportedImage(file: File) {
  const lowerName = file.name.toLowerCase();
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dateKey(value: string | null | undefined) {
  if (!value) return null;
  const directDate = value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  if (directDate) return directDate;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function findDayIdForExifDate(days: Day[], exif: ExtractedExif) {
  const takenDate = dateKey(exif.takenDate ?? exif.takenAt);
  if (!takenDate) return null;
  return days.find((day) => day.date === takenDate)?.id ?? null;
}

function routeGeometry(route: RouteSegment): LineString {
  return (route.geometry_geojson.type === "Feature" ? route.geometry_geojson.geometry : route.geometry_geojson) as LineString;
}

function routeLengthKilometers(route: RouteSegment) {
  if (route.distance_meters && route.distance_meters > 0) return route.distance_meters / 1000;
  return turfLength({ type: "Feature", geometry: routeGeometry(route), properties: {} }, { units: "kilometers" });
}

function routeForDay(routes: RouteSegment[], dayId: string) {
  return routes
    .filter((route) => route.day_id === dayId && routeGeometry(route).coordinates.length >= 2)
    .sort((a, b) => routeLengthKilometers(b) - routeLengthKilometers(a))[0] ?? null;
}

function coordinateAlongRoute(route: RouteSegment, fraction: number): LngLat | null {
  const geometry = routeGeometry(route);
  if (geometry.coordinates.length < 2) return null;
  const line = lineString(geometry.coordinates);
  const totalKilometers = turfLength(line, { units: "kilometers" });
  if (totalKilometers <= 0) return null;
  const position = along(line, totalKilometers * Math.min(0.96, Math.max(0.04, fraction)), { units: "kilometers" });
  const [lng, lat] = position.geometry.coordinates;
  return { lng, lat };
}

function findDayIdForCoordinate(routes: RouteSegment[], coordinate: LngLat | null) {
  if (!coordinate) return null;
  let nearest: { dayId: string; meters: number } | null = null;
  const photoPoint = point([coordinate.lng, coordinate.lat]);
  for (const route of routes) {
    if (!route.day_id) continue;
    const meters = pointToLineDistance(photoPoint, routeGeometry(route), { units: "meters" });
    if (!nearest || meters < nearest.meters) nearest = { dayId: route.day_id, meters };
  }
  return nearest && nearest.meters <= 500 ? nearest.dayId : null;
}

function coordinateKey(coordinate: LngLat) {
  return `${coordinate.lat.toFixed(7)},${coordinate.lng.toFixed(7)}`;
}

function routePlaceNoGpsItems(items: AnalyzedItem[], routes: RouteSegment[]) {
  const byDay = new Map<string, AnalyzedItem[]>();
  for (const item of items) {
    if (item.status === "invalid" || item.status === "reading" || item.coordinate || !item.dayId) continue;
    if (!routeForDay(routes, item.dayId)) continue;
    const dayItems = byDay.get(item.dayId) ?? [];
    dayItems.push(item);
    byDay.set(item.dayId, dayItems);
  }

  for (const [dayId, dayItems] of byDay.entries()) {
    const route = routeForDay(routes, dayId);
    if (!route) continue;
    dayItems
      .sort((a, b) => {
        const aTime = a.exif?.takenAt ? new Date(a.exif.takenAt).getTime() : Number.NaN;
        const bTime = b.exif?.takenAt ? new Date(b.exif.takenAt).getTime() : Number.NaN;
        if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
        return a.order - b.order;
      })
      .forEach((item, index) => {
        const coordinate = coordinateAlongRoute(route, dayItems.length === 1 ? 0.5 : (index + 1) / (dayItems.length + 1));
        if (!coordinate) return;
        item.coordinate = coordinate;
        item.locationSource = "route";
        item.status = "ready";
        item.message = "No GPS found. Placed on the day's route by photo time/order. Tap map to adjust.";
      });
  }

  return items;
}

function routePlaceQueueItems(items: QueueItem[], routes: RouteSegment[]) {
  const analyzed = routePlaceNoGpsItems(items.map((item, order) => ({
    id: item.id,
    order,
    dayId: item.dayId,
    dayMatchSource: item.dayMatchSource,
    locationSource: item.locationSource,
    exif: item.exif,
    coordinate: item.coordinate,
    status: item.status,
    message: item.message,
  })), routes);
  const analyzedById = new Map(analyzed.map((item) => [item.id, item]));
  return items.map((item) => {
    const analyzedItem = analyzedById.get(item.id);
    return analyzedItem ? {
      ...item,
      dayId: analyzedItem.dayId,
      dayMatchSource: analyzedItem.dayMatchSource,
      locationSource: analyzedItem.locationSource,
      exif: analyzedItem.exif,
      coordinate: analyzedItem.coordinate,
      status: analyzedItem.status,
      message: analyzedItem.message,
    } : item;
  });
}

function dayLabel(days: Day[], dayId: string | null) {
  const day = days.find((item) => item.id === dayId);
  if (!day) return "All days";
  return `Day ${day.day_number}${day.title ? `: ${day.title}` : ""}`;
}

function locationLabel(item: QueueItem) {
  if (item.status === "ready" && item.locationSource === "gps") return "GPS ready";
  if (item.status === "ready" && item.locationSource === "route") return "Placed on route";
  if (item.status === "ready" && item.locationSource === "manual") return "Placed manually";
  if (item.status === "ready") return "Ready to upload";
  if (item.status === "needs-location") return "Tap map to place";
  if (item.status === "reading") return "Reading metadata";
  return item.message;
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

export function UploadPhotoPanel({ days, routes, defaultDayId, pendingCoordinate, isSaving, onCancel, onCoordinatePreview, onSave }: Props) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [uploaderName, setUploaderName] = useState("");
  const [batchOverrideDayId, setBatchOverrideDayId] = useState(BATCH_OVERRIDE_IDLE);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const previewCoordinateKeyRef = useRef<string | null>(null);
  const activeItem = items.find((item) => item.id === activeItemId) ?? items[0] ?? null;
  const activePreviewUrl = useMemo(() => activeItem ? URL.createObjectURL(activeItem.file) : null, [activeItem]);

  useEffect(() => () => {
    if (activePreviewUrl) URL.revokeObjectURL(activePreviewUrl);
  }, [activePreviewUrl]);

  useEffect(() => {
    if (activeItem?.coordinate) {
      previewCoordinateKeyRef.current = coordinateKey(activeItem.coordinate);
      onCoordinatePreview(activeItem.coordinate);
    } else if (activeItem?.status === "needs-location") {
      previewCoordinateKeyRef.current = null;
      onCoordinatePreview(null);
    }
  }, [activeItem?.coordinate, activeItem?.id, activeItem?.status, onCoordinatePreview]);

  useEffect(() => {
    if (!pendingCoordinate || !activeItemId) return;
    const nextKey = coordinateKey(pendingCoordinate);
    if (previewCoordinateKeyRef.current === nextKey) {
      previewCoordinateKeyRef.current = null;
      return;
    }
    setItems((current) => current.map((item) => item.id === activeItemId && item.status !== "invalid" && item.status !== "reading"
      ? { ...item, coordinate: pendingCoordinate, locationSource: "manual", status: "ready", message: "Location set from the map." }
      : item));
  }, [activeItemId, pendingCoordinate]);

  const counts = useMemo(() => ({
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    needsLocation: items.filter((item) => item.status === "needs-location").length,
    reading: items.filter((item) => item.status === "reading").length,
    invalid: items.filter((item) => item.status === "invalid").length,
    matchedByDate: items.filter((item) => item.dayMatchSource === "date").length,
    matchedByRoute: items.filter((item) => item.dayMatchSource === "route").length,
    placedOnRoute: items.filter((item) => item.locationSource === "route").length,
    unassigned: items.filter((item) => item.status !== "invalid" && item.dayId === null).length,
    review: items.filter((item) => item.status !== "invalid" && (item.status === "needs-location" || item.dayId === null)).length,
  }), [items]);

  const dayBuckets = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const item of items) {
      if (item.status === "invalid") continue;
      const key = item.dayId ?? "";
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from(buckets.entries()).map(([key, count]) => ({ dayId: key || null, count }));
  }, [items]);

  const visibleItems = useMemo(() => {
    if (queueFilter === "all") return items;
    if (queueFilter === "review") return items.filter((item) => item.status !== "invalid" && (item.status === "needs-location" || item.dayId === null));
    return items.filter((item) => item.status === queueFilter);
  }, [items, queueFilter]);

  useEffect(() => {
    if (visibleItems.length === 0) return;
    if (activeItemId && visibleItems.some((item) => item.id === activeItemId)) return;
    setActiveItemId(visibleItems[0].id);
  }, [activeItemId, visibleItems]);

  async function handleFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;

    const nextItems: QueueItem[] = selected.map((file) => {
      const id = crypto.randomUUID();
      if (!isSupportedImage(file)) {
        return { id, file, caption: "", dayId: null, dayMatchSource: null, locationSource: null, exif: null, coordinate: null, status: "invalid", message: "Unsupported file type." };
      }
      if (file.size > MAX_FILE_SIZE) {
        return { id, file, caption: "", dayId: null, dayMatchSource: null, locationSource: null, exif: null, coordinate: null, status: "invalid", message: `Over ${formatBytes(MAX_FILE_SIZE)}. Export a smaller copy first.` };
      }
      return { id, file, caption: "", dayId: defaultDayId, dayMatchSource: null, locationSource: null, exif: null, coordinate: null, status: "reading", message: "Reading photo metadata..." };
    });

    setItems((current) => [...current, ...nextItems]);
    setActiveItemId((current) => current ?? nextItems[0]?.id ?? null);

    const readable = nextItems.filter((item) => item.status === "reading");
    const extracted = new Map<string, ExtractedExif>();
    await mapWithConcurrency(readable, EXIF_CONCURRENCY, async (item) => {
      const exif = await extractPhotoExif(item.file);
      extracted.set(item.id, exif);
    });

    const analyzed = routePlaceNoGpsItems(readable.map((item, order) => {
      const exif = extracted.get(item.id);
      if (!exif) {
        return { id: item.id, order, dayId: item.dayId, dayMatchSource: null, locationSource: null, exif: null, coordinate: null, status: "invalid" as const, message: "We could not read this photo." };
      }
      const coordinate = exif.lat !== null && exif.lng !== null ? { lat: exif.lat, lng: exif.lng } : null;
      const matchedDayId = findDayIdForExifDate(days, exif);
      const routeDayId = matchedDayId ? null : findDayIdForCoordinate(routes, coordinate);
      return {
        id: item.id,
        order,
        dayId: matchedDayId ?? routeDayId ?? item.dayId,
        dayMatchSource: matchedDayId ? "date" as const : routeDayId ? "route" as const : null,
        locationSource: coordinate ? "gps" as const : null,
        exif,
        coordinate,
        status: coordinate ? "ready" as const : "needs-location" as const,
        message: exif.message,
      };
    }), routes);
    const analyzedById = new Map(analyzed.map((item) => [item.id, item]));

    setItems((current) => current.map((currentItem) => {
      const analyzedItem = analyzedById.get(currentItem.id);
      if (!analyzedItem) return currentItem;
      return {
        ...currentItem,
        dayId: analyzedItem.dayId,
        dayMatchSource: analyzedItem.dayMatchSource,
        locationSource: analyzedItem.locationSource,
        exif: analyzedItem.exif,
        coordinate: analyzedItem.coordinate,
        status: analyzedItem.status,
        message: analyzedItem.message,
      };
    }));
  }

  async function submit(formData: FormData) {
    const readyItems = items.filter((item) => item.status === "ready" && item.coordinate);
    if (readyItems.length === 0) return;
    const result = await onSave(readyItems.map((item) => ({
      clientId: item.id,
      file: item.file,
      caption: item.caption,
      uploaderName: String(formData.get("uploaderName") ?? "").trim(),
      dayId: item.dayId,
      coordinate: item.coordinate!,
      exif: item.exif,
    })));
    if (!result || result.savedClientIds.length === 0 || result.failedClientIds.length === 0) return;
    const savedIds = new Set(result.savedClientIds);
    setItems((current) => current.filter((item) => !savedIds.has(item.id)));
    setActiveItemId(result.failedClientIds[0] ?? null);
  }

  function setActiveDay(nextDayId: string) {
    if (!activeItem) return;
    setItems((current) => routePlaceQueueItems(current.map((item) => {
      if (item.id !== activeItem.id) return item;
      const dayId = nextDayId || null;
      return {
        ...item,
        dayId,
        dayMatchSource: null,
        locationSource: item.coordinate ? item.locationSource : null,
        status: item.status === "invalid" || item.status === "reading" || item.coordinate ? item.status : "needs-location",
        message: item.coordinate || !dayId ? item.message : "Day set. Tap map to place if it is not on the route.",
      };
    }), routes));
  }

  function applyBatchDay(nextDayId: string) {
    if (nextDayId === BATCH_OVERRIDE_IDLE) return;
    setBatchOverrideDayId(nextDayId);
    const dayId = nextDayId === ALL_DAYS_VALUE ? null : nextDayId;
    setItems((current) => routePlaceQueueItems(current.map((item) => {
      if (item.status === "invalid") return item;
      return {
        ...item,
        dayId,
        dayMatchSource: null,
        locationSource: item.coordinate ? item.locationSource : null,
        status: item.status === "reading" || item.coordinate ? item.status : "needs-location",
        message: item.coordinate || !dayId ? item.message : "Day set. Tap map to place if it is not on the route.",
      };
    }), routes));
  }

  return (
    <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.4rem] border border-stone-200/80 bg-[rgba(255,253,246,0.96)] text-stone-950 shadow-[0_24px_80px_rgba(46,61,54,0.22)] backdrop-blur-xl md:bottom-6 md:left-auto md:right-6 md:w-[30rem]">
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col p-4 md:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-semibold tracking-tight text-stone-950">Upload photo</h2>
          <p className="mt-1 text-sm leading-5 text-stone-600">Choose one shot or a whole camera roll batch. GPS, dates, and route placement are prepared locally.</p>
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

        {items.length > 0 ? (
          <div className="rounded-lg border border-teal-700/15 bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-950">
            <div className="font-bold">{counts.matchedByDate} date matched · {counts.matchedByRoute} GPS near route · {counts.placedOnRoute} route placed · {counts.unassigned} unassigned</div>
            {dayBuckets.length > 0 ? <div className="mt-1 text-teal-900/80">{dayBuckets.map((bucket) => `${bucket.count} ${dayLabel(days, bucket.dayId)}`).join(" · ")}</div> : null}
          </div>
        ) : null}

        {items.length > 0 ? (
          <div className="grid grid-cols-4 gap-1 rounded-lg border border-stone-200 bg-white p-1 text-xs font-bold text-stone-600">
            {([
              ["all", "All", counts.total],
              ["review", "Review", counts.review],
              ["needs-location", "Place", counts.needsLocation],
              ["invalid", "Issues", counts.invalid],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setQueueFilter(key)}
                className={cn(
                  "rounded-md px-2 py-1.5 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/15",
                  queueFilter === key ? "bg-teal-700 text-white shadow-sm" : "hover:bg-stone-100",
                )}
              >
                {label} <span className={cn("ml-1", queueFilter === key ? "text-white/80" : "text-stone-400")}>{count}</span>
              </button>
            ))}
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
                {activeItem.status === "reading" ? <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin" /> : activeItem.status === "ready" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5" /> : activeItem.status === "invalid" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> : <MapPin className="mt-0.5 h-3.5 w-3.5" />}
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
              {visibleItems.length === 0 ? (
                <div className="flex min-h-20 items-center justify-center rounded-md bg-stone-50 px-3 text-center text-xs leading-5 text-stone-500">
                  No photos in this view.
                </div>
              ) : visibleItems.map((item) => {
                const index = items.findIndex((candidate) => candidate.id === item.id);
                return (
                <button type="button" key={item.id} onClick={() => setActiveItemId(item.id)} className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left transition", activeItemId === item.id ? "bg-teal-50 ring-1 ring-teal-700/30" : "hover:bg-stone-100")}>
                  <span className="text-xs font-bold text-stone-400">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-stone-900">{item.file.name}</span>
                    <span className="block truncate text-[11px] text-stone-500">{locationLabel(item)}</span>
                    <span className="block truncate text-[11px] font-semibold text-teal-800">{dayLabel(days, item.dayId)}{item.dayMatchSource ? ` · ${item.dayMatchSource} matched` : ""}</span>
                  </span>
                  {item.status === "invalid" ? <AlertTriangle className="h-4 w-4 text-rose-500" /> : <span className={cn("h-2.5 w-2.5 rounded-full", item.status === "ready" ? "bg-emerald-500" : item.status === "needs-location" ? "bg-amber-500" : "bg-stone-300")} />}
                </button>
                );
              })}
            </div>
          )}
        </div>

        {items.length > 0 ? (
          <>
            <label className="rounded-lg border border-teal-700/25 bg-teal-50 px-3 py-2 text-sm text-teal-950">
              <MapPin className="mr-2 inline h-4 w-4" />
              {activeItem?.coordinate ? `${activeItem.coordinate.lat.toFixed(5)}, ${activeItem.coordinate.lng.toFixed(5)} · Tap map to adjust selected photo.` : activeItem?.status === "needs-location" ? "Tap the map to place the selected photo." : "GPS coordinates appear here when available."}
            </label>

            <textarea value={activeItem?.caption ?? ""} onChange={(event) => {
              const value = event.target.value;
              if (!activeItem) return;
              setItems((current) => current.map((item) => item.id === activeItem.id ? { ...item, caption: value } : item));
            }} maxLength={280} placeholder="Caption for selected photo" className="min-h-16 w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
            <div className="grid grid-cols-2 gap-2">
              <input name="uploaderName" value={uploaderName} onChange={(event) => setUploaderName(event.target.value)} placeholder="Your name" className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
              <select value={activeItem?.dayId ?? ""} onChange={(event) => setActiveDay(event.target.value)} disabled={!activeItem} className="rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Selected photo day">
                <option value="">All days</option>
                {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
              </select>
            </div>

            <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-stone-200 bg-white/80 px-3 py-2 text-xs font-semibold text-stone-600">
              <span>Override all</span>
              <select value={batchOverrideDayId} onChange={(event) => applyBatchDay(event.target.value)} className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
                <option value={BATCH_OVERRIDE_IDLE} disabled>Choose day...</option>
                <option value={ALL_DAYS_VALUE}>All days</option>
                {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
              </select>
            </label>

            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button type="button" onClick={() => { setItems([]); setActiveItemId(null); onCoordinatePreview(null); }} disabled={isSaving} className="rounded-lg border border-stone-300 bg-white px-3 text-stone-600 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45" aria-label="Clear queue"><RotateCcw className="h-4 w-4" /></button>
              <button disabled={counts.ready === 0 || counts.reading > 0 || isSaving} className="rounded-lg bg-[#e7a13d] px-4 py-3 text-sm font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
                {isSaving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <Upload className="mr-2 inline h-4 w-4" />} Upload {counts.ready > 1 ? `${counts.ready} photos` : "photo"}
              </button>
            </div>
          </>
        ) : null}
      </form>
      </div>
    </div>
  );
}
