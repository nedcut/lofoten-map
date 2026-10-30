// Server-side data for the link-preview image (app/opengraph-image.tsx): the
// trip's title and numbers, a cover photo, and the shape of its routes. It
// reads the same public, RLS-protected Data API the browser does, with Neon
// Auth's anonymous token, and gives up quietly (returning null) on any
// failure so a build without a backend still gets the plain card.

import { dayColorAt } from "@/lib/day-colors";
import { PHOTO_BUCKET, publicObjectUrl } from "@/lib/object-store";

export type OgRoute = { color: string; onFoot: boolean; points: Array<[number, number]> };
export type OgTrip = {
  title: string;
  description: string | null;
  dayCount: number;
  photoCount: number;
  onFootKm: number;
  coverUrl: string | null;
  routes: OgRoute[];
};

const FETCH_TIMEOUT_MS = 8000;

async function getJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}`, Accept: "application/json" } : { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json() as Promise<T>;
}

/**
 * Width and height from a JPEG's start-of-frame header, without decoding it.
 * Null for anything that isn't a readable baseline or progressive JPEG.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    // SOF0..SOF15, minus DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

type Geometry = { type: string; coordinates?: unknown; geometry?: Geometry };

function lineCoordinates(geometry: Geometry | null | undefined): Array<[number, number]> {
  const line = geometry?.type === "Feature" ? geometry.geometry : geometry;
  if (line?.type !== "LineString" || !Array.isArray(line.coordinates)) return [];
  return (line.coordinates as unknown[]).flatMap((point) =>
    Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number" ? [[point[0], point[1]] as [number, number]] : []);
}

/**
 * Fits route lines into a width×height box (equirectangular, scaled by the
 * latitude so the islands keep their shape), preserving aspect and centring.
 * Returns screen-space points, y down.
 */
export function projectRoutes(routes: OgRoute[], width: number, height: number): OgRoute[] {
  const all = routes.flatMap((route) => route.points);
  if (all.length === 0) return [];
  const midLat = all.reduce((sum, [, lat]) => sum + lat, 0) / all.length;
  const xScale = Math.cos((midLat * Math.PI) / 180);
  const xs = all.map(([lng]) => lng * xScale);
  const ys = all.map(([, lat]) => lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(width / Math.max(maxX - minX, 1e-9), height / Math.max(maxY - minY, 1e-9));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  return routes.map((route) => ({
    ...route,
    points: route.points.map(([lng, lat]) => [offsetX + (lng * xScale - minX) * scale, offsetY + (maxY - lat) * scale] as [number, number]),
  }));
}

type TripRow = { id: string; title: string; description: string | null };
type DayRow = { id: string; day_number: number };
type RouteRow = { day_id: string | null; mode: string; distance_meters: number | null; geometry_geojson: Geometry };
type PhotoRow = { image_path: string; thumbnail_path: string | null; taken_at: string | null };

// The cover: the first landscape among a few photos sampled across the trip,
// nearest its middle first (arrival-day logistics rarely make the best cover).
async function pickCover(photos: PhotoRow[]): Promise<string | null> {
  if (photos.length === 0) return null;
  const order = Array.from({ length: 8 }, (_, i) => photos[Math.floor((0.6 + (i % 2 ? 1 : -1) * 0.07 * Math.ceil(i / 2)) * photos.length)])
    .filter((photo): photo is PhotoRow => Boolean(photo));
  // One time budget for all probes, not one each: a stalled photo host must
  // not hold the build past Next's 60s page-generation limit.
  const budget = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (const photo of order) {
    const probeUrl = publicObjectUrl(PHOTO_BUCKET, photo.thumbnail_path ?? photo.image_path);
    if (!probeUrl) continue;
    try {
      const response = await fetch(probeUrl, { headers: { Range: "bytes=0-65535" }, signal: budget });
      const size = jpegSize(new Uint8Array(await response.arrayBuffer()));
      if (size && size.width > size.height * 1.2) return publicObjectUrl(PHOTO_BUCKET, photo.image_path);
    } catch {
      // Try the next candidate.
    }
  }
  if (budget.aborted) return null;
  return publicObjectUrl(PHOTO_BUCKET, order[0]?.image_path ?? null);
}

export async function loadOgTrip(slug: string): Promise<OgTrip | null> {
  const authUrl = process.env.NEXT_PUBLIC_NEON_AUTH_URL?.replace(/\/$/, "");
  const dataUrl = process.env.NEXT_PUBLIC_NEON_DATA_API_URL?.replace(/\/$/, "");
  if (!authUrl || !dataUrl) return null;
  try {
    const { token } = await getJson<{ token: string }>(`${authUrl}/token/anonymous`);
    const [trip] = await getJson<TripRow[]>(`${dataUrl}/trips?slug=eq.${encodeURIComponent(slug)}&select=id,title,description`, token);
    if (!trip) return null;
    const tripFilter = `trip_id=eq.${encodeURIComponent(trip.id)}`;
    const [days, routeRows, photos] = await Promise.all([
      getJson<DayRow[]>(`${dataUrl}/days?${tripFilter}&select=id,day_number&order=day_number`, token),
      getJson<RouteRow[]>(`${dataUrl}/route_segments?${tripFilter}&select=day_id,mode,distance_meters,geometry_geojson`, token),
      getJson<PhotoRow[]>(`${dataUrl}/photos?${tripFilter}&media_type=eq.photo&select=image_path,thumbnail_path,taken_at&order=taken_at`, token),
    ]);
    const dayIndex = new Map(days.map((day, index) => [day.id, index]));
    const onFoot = (mode: string) => mode === "hike" || mode === "walk";
    const routes = routeRows
      .map((route) => ({ color: dayColorAt(route.day_id ? dayIndex.get(route.day_id) ?? -1 : -1), onFoot: onFoot(route.mode), points: lineCoordinates(route.geometry_geojson) }))
      .filter((route) => route.points.length > 1);
    const onFootMeters = routeRows.reduce((sum, route) => sum + (onFoot(route.mode) ? route.distance_meters ?? 0 : 0), 0);
    return {
      title: trip.title,
      description: trip.description,
      dayCount: days.length,
      photoCount: photos.length,
      onFootKm: Math.round(onFootMeters / 1000),
      coverUrl: await pickCover(photos),
      routes,
    };
  } catch {
    return null;
  }
}

/**
 * One of the app's fonts as a TTF (satori can't read WOFF2), subset to the
 * characters in `text`. `axes` is the Google Fonts CSS2 axis spec, e.g.
 * "opsz,wght@144,600". Fetched when the image is built, never by visitors.
 */
export async function loadGoogleFont(family: string, axes: string, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axes}&text=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype)'\)/)?.[1];
    if (!url) return null;
    return await (await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })).arrayBuffer();
  } catch {
    return null;
  }
}
