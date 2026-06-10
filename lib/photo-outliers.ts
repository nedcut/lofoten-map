import { distanceKm } from "./journey-leg";
import type { LngLat, Photo } from "@/types/trip";

// A photo whose position disagrees with where the photos taken around the
// same time were taken — usually a wrong manual placement or GPS glitch.
export type PhotoOutlier = {
  photo: Photo;
  // How far the photo sits from its time-neighbors' center.
  distanceKm: number;
  // Robust center of the neighbors: the suggested corrected position.
  suggested: LngLat;
  neighborCount: number;
  windowMinutes: number;
};

export type DetectOutlierOptions = {
  // Photos taken within this many minutes (either side) count as neighbors.
  windowMinutes?: number;
  // Fewer neighbors than this and there is no consensus to compare against.
  minNeighbors?: number;
  // Base distance that is always tolerated (GPS error, short wanders).
  baseToleranceKm?: number;
  // On top of the base, tolerate this multiple of the neighbors' own spread,
  // so photos taken while moving (hike, ferry) don't all flag each other.
  spreadMultiplier?: number;
};

const DEFAULTS: Required<DetectOutlierOptions> = {
  windowMinutes: 20,
  minNeighbors: 3,
  baseToleranceKm: 0.5,
  spreadMultiplier: 4,
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type Located = { photo: Photo; coord: LngLat; timeMs: number };

function locatedPhotos(photos: Photo[]): Located[] {
  const result: Located[] = [];
  for (const photo of photos) {
    if (photo.lat === null || photo.lng === null || !photo.taken_at) continue;
    const timeMs = new Date(photo.taken_at).getTime();
    if (!Number.isFinite(timeMs)) continue;
    result.push({ photo, coord: { lat: photo.lat, lng: photo.lng }, timeMs });
  }
  return result.sort((a, b) => a.timeMs - b.timeMs);
}

// Find photos that sit far from where their time-neighbors were taken.
// Component-wise medians make both the center and the spread robust: a second
// misplaced photo among the neighbors cannot drag the consensus toward itself.
export function detectPhotoOutliers(photos: Photo[], options: DetectOutlierOptions = {}): PhotoOutlier[] {
  const { windowMinutes, minNeighbors, baseToleranceKm, spreadMultiplier } = { ...DEFAULTS, ...options };
  const located = locatedPhotos(photos);
  const windowMs = windowMinutes * 60_000;
  const outliers: PhotoOutlier[] = [];

  for (const candidate of located) {
    const neighbors = located.filter(
      (other) => other.photo.id !== candidate.photo.id && Math.abs(other.timeMs - candidate.timeMs) <= windowMs,
    );
    if (neighbors.length < minNeighbors) continue;

    const suggested: LngLat = {
      lat: median(neighbors.map((entry) => entry.coord.lat)),
      lng: median(neighbors.map((entry) => entry.coord.lng)),
    };
    const spreadKm = median(neighbors.map((entry) => distanceKm(entry.coord, suggested)));
    const offsetKm = distanceKm(candidate.coord, suggested);

    if (offsetKm > baseToleranceKm + spreadMultiplier * spreadKm) {
      outliers.push({
        photo: candidate.photo,
        distanceKm: offsetKm,
        suggested,
        neighborCount: neighbors.length,
        windowMinutes,
      });
    }
  }

  return outliers.sort((a, b) => b.distanceKm - a.distanceKm);
}
