import along from "@turf/along";
import turfLength from "@turf/length";
import { lineString, point } from "@turf/helpers";
import pointToLineDistance from "@turf/point-to-line-distance";
import type { LineString } from "geojson";
import type { ExtractedExif } from "./exif";
import type { Day, LngLat, RouteSegment } from "@/types/trip";

// Pure logic for the photo-import queue: matching photos to trip days (by
// EXIF date, then by proximity to a day's route), auto-placing GPS-less
// photos along the day's route, and the labels derived from queue state.
// Kept out of UploadPhotoPanel so the placement rules are unit-testable.

// The import flow is a small linear state machine. "place" is conditional — it is
// only shown when some photos lack a location. Uploading is the primary action on
// both Review and Place, so there is no separate final step.
export type Step = "select" | "review" | "place";

export type QueueStatus = "reading" | "ready" | "needs-location" | "invalid";
export type QueueFilter = "all" | "review" | "needs-location" | "invalid";

export type QueueItem = {
  id: string;
  file: File;
  mediaType: "photo" | "video";
  contentHash: string | null;
  caption: string;
  dayId: string | null;
  dayMatchSource: "date" | "route" | null;
  locationSource: "gps" | "route" | "manual" | null;
  exif: ExtractedExif | null;
  coordinate: LngLat | null;
  status: QueueStatus;
  message: string;
};

export type AnalyzedItem = Pick<QueueItem, "id" | "dayId" | "dayMatchSource" | "locationSource" | "exif" | "coordinate" | "status" | "message"> & {
  order: number;
};

export function mediaLabel(mediaType: "photo" | "video") {
  return mediaType === "video" ? "video" : "photo";
}

export function formatBytes(bytes: number) {
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

export function findDayIdForExifDate(days: Day[], exif: ExtractedExif) {
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

export function coordinateAlongRoute(route: RouteSegment, fraction: number): LngLat | null {
  const geometry = routeGeometry(route);
  if (geometry.coordinates.length < 2) return null;
  const line = lineString(geometry.coordinates);
  const totalKilometers = turfLength(line, { units: "kilometers" });
  if (totalKilometers <= 0) return null;
  const position = along(line, totalKilometers * Math.min(0.96, Math.max(0.04, fraction)), { units: "kilometers" });
  const [lng, lat] = position.geometry.coordinates;
  return { lng, lat };
}

export function findDayIdForCoordinate(routes: RouteSegment[], coordinate: LngLat | null) {
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

export function coordinateKey(coordinate: LngLat) {
  return `${coordinate.lat.toFixed(7)},${coordinate.lng.toFixed(7)}`;
}

export function routePlaceNoGpsItems(items: AnalyzedItem[], routes: RouteSegment[]) {
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

export function routePlaceQueueItems(items: QueueItem[], routes: RouteSegment[]) {
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

export function dayLabel(days: Day[], dayId: string | null) {
  const day = days.find((item) => item.id === dayId);
  if (!day) return "All days";
  return `Day ${day.day_number}${day.title ? `: ${day.title}` : ""}`;
}

export function locationLabel(item: QueueItem) {
  if (item.status === "ready" && item.locationSource === "gps") return "GPS ready";
  if (item.status === "ready" && item.locationSource === "route") return "Placed on route";
  if (item.status === "ready" && item.locationSource === "manual") return "Placed manually";
  if (item.status === "ready") return "Ready to upload";
  if (item.status === "needs-location") return "Tap map to place";
  if (item.status === "reading") return "Reading metadata";
  return item.message;
}

// Steps shown in the progress header. Place is hidden unless something needs a pin.
export function stepFlow(hasPlacement: boolean): Step[] {
  return hasPlacement ? ["select", "review", "place"] : ["select", "review"];
}
