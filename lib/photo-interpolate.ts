import type { AnalyzedItem } from "./upload-queue";
import type { LngLat, Photo } from "@/types/trip";

// Places GPS-less photos by time-interpolating between "anchors" — photos
// whose position is trusted (EXIF GPS in the same import batch, or photos
// already uploaded to the trip). A photo taken at 14:05 between anchors at
// 13:50 and 14:20 lands proportionally between them. Runs before the
// route-spreading fallback in upload-queue.ts, so it wins when it applies.

export type TimeAnchor = {
  timeMs: number;
  coordinate: LngLat;
};

function parseTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

// Anchors come from two pools: batch items that carried EXIF GPS, and photos
// already on the trip. Both need a usable timestamp. Sorted by time so
// neighbor lookup can binary-scan.
export function collectTimeAnchors(items: AnalyzedItem[], existingPhotos: Photo[]): TimeAnchor[] {
  const anchors: TimeAnchor[] = [];
  for (const item of items) {
    if (item.locationSource !== "gps" || !item.coordinate) continue;
    const timeMs = parseTimeMs(item.exif?.takenAt);
    if (timeMs === null) continue;
    anchors.push({ timeMs, coordinate: item.coordinate });
  }
  for (const photo of existingPhotos) {
    if (photo.lat === null || photo.lng === null) continue;
    const timeMs = parseTimeMs(photo.taken_at);
    if (timeMs === null) continue;
    anchors.push({ timeMs, coordinate: { lat: photo.lat, lng: photo.lng } });
  }
  return anchors.sort((a, b) => a.timeMs - b.timeMs);
}

// Nearest anchor at-or-before and strictly-after the photo's time.
export function neighborAnchors(anchors: TimeAnchor[], takenAtMs: number): { before: TimeAnchor | null; after: TimeAnchor | null } {
  let before: TimeAnchor | null = null;
  let after: TimeAnchor | null = null;
  for (const anchor of anchors) {
    if (anchor.timeMs <= takenAtMs) before = anchor;
    else {
      after = anchor;
      break;
    }
  }
  return { before, after };
}

// Anchors further apart than this describe two separate scenes, not a path —
// lerping between them would drop photos somewhere meaningless (or in the
// sea, on ferry days). Two hours tolerates a long hike between fixes while
// every placement stays adjustable by drag.
const MAX_LERP_GAP_MS = 2 * 60 * 60 * 1000;
// With only one usable anchor, assume "same spot" only when the photo was
// taken within this window of it.
const MAX_SNAP_GAP_MS = 15 * 60 * 1000;

// Decides where (and whether) to place a photo relative to its time
// neighbors. Returns null to decline — the photo then falls through to
// route placement or manual placement.
export function interpolatedCoordinate(before: TimeAnchor | null, after: TimeAnchor | null, takenAtMs: number): LngLat | null {
  if (before && after) {
    const gap = after.timeMs - before.timeMs;
    if (gap <= 0) return before.coordinate;
    if (gap <= MAX_LERP_GAP_MS) {
      const fraction = (takenAtMs - before.timeMs) / gap;
      return {
        lat: before.coordinate.lat + (after.coordinate.lat - before.coordinate.lat) * fraction,
        lng: before.coordinate.lng + (after.coordinate.lng - before.coordinate.lng) * fraction,
      };
    }
    // Anchors too far apart to trust the path between them; fall through to
    // snapping against whichever one is close in time, if either is.
  }
  const nearest = [before, after]
    .filter((anchor): anchor is TimeAnchor => anchor !== null)
    .map((anchor) => ({ anchor, distanceMs: Math.abs(takenAtMs - anchor.timeMs) }))
    .sort((a, b) => a.distanceMs - b.distanceMs)[0] ?? null;
  if (nearest && nearest.distanceMs <= MAX_SNAP_GAP_MS) return nearest.anchor.coordinate;
  return null;
}

// Pass over the analyzed queue: every GPS-less photo with a timestamp gets a
// shot at interpolation. Mirrors routePlaceNoGpsItems' mutate-and-return style.
export function timeInterpolateItems(items: AnalyzedItem[], anchors: TimeAnchor[]): AnalyzedItem[] {
  if (anchors.length === 0) return items;
  for (const item of items) {
    if (item.status === "invalid" || item.status === "reading" || item.coordinate) continue;
    const takenAtMs = parseTimeMs(item.exif?.takenAt);
    if (takenAtMs === null) continue;
    const { before, after } = neighborAnchors(anchors, takenAtMs);
    const coordinate = interpolatedCoordinate(before, after, takenAtMs);
    if (!coordinate) continue;
    item.coordinate = coordinate;
    item.locationSource = "time";
    item.status = "ready";
    item.message = "No GPS found. Placed between nearby photos by time. Tap map to adjust.";
  }
  return items;
}
