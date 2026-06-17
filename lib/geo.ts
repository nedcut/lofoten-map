import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { LngLat, Note, Photo, Place, RouteSegment } from "@/types/trip";

export const LOFOTEN_CENTER: [number, number] = [13.0897, 67.9325];

export type CoordinateBounds = { sw: [number, number]; ne: [number, number]; center: [number, number]; diagonalMeters: number };

// Great-circle (haversine) distance, inlined so route/bounds math doesn't pull
// @turf/length (and its @turf/distance/helpers/meta deps) into the page graph —
// geo.ts is the only Turf consumer reachable from the initial bundle, so this
// drops Turf from first load entirely. Uses Turf's mean Earth radius so the
// displayed distances stay identical to the previous implementation.
const EARTH_RADIUS_METERS = 6_371_008.8;

function segmentDistanceMeters([fromLng, fromLat]: [number, number], [toLng, toLat]: [number, number]): number {
  const fromPhi = (fromLat * Math.PI) / 180;
  const toPhi = (toLat * Math.PI) / 180;
  const deltaPhi = ((toLat - fromLat) * Math.PI) / 180;
  const deltaLambda = ((toLng - fromLng) * Math.PI) / 180;
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(fromPhi) * Math.cos(toPhi) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function geometryDistanceMeters(geometry: LineString): number {
  let meters = 0;
  for (let i = 1; i < geometry.coordinates.length; i += 1) {
    meters += segmentDistanceMeters(geometry.coordinates[i - 1] as [number, number], geometry.coordinates[i] as [number, number]);
  }
  return meters;
}

/**
 * Axis-aligned bounds for a set of [lng, lat] coordinates, in the shape
 * map.fitBounds accepts ([sw, ne]). Replaces mapboxgl.LngLatBounds at call
 * sites that must not import mapbox-gl eagerly: a static import anywhere in
 * the page graph pulls the whole 1.7MB library into the initial bundle,
 * defeating MapView's dynamic() split. diagonalMeters supports the
 * "lone point can't be fit, ease instead" check.
 */
export function coordinateBounds(coords: [number, number][]): CoordinateBounds | null {
  if (coords.length === 0) return null;
  let [minLng, minLat] = coords[0];
  let [maxLng, maxLat] = coords[0];
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return {
    sw: [minLng, minLat],
    ne: [maxLng, maxLat],
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
    diagonalMeters: segmentDistanceMeters([minLng, minLat], [maxLng, maxLat]),
  };
}

// Great-circle distance between two points in kilometers. Mirrors @turf/distance
// (same Earth radius) so callers like photo-outlier detection can reach it
// without importing the Turf-heavy journey-leg module into the page graph.
export function distanceKm(a: LngLat, b: LngLat): number {
  return segmentDistanceMeters([a.lng, a.lat], [b.lng, b.lat]) / 1000;
}

export function routeGeometry(points: LngLat[]): LineString {
  return { type: "LineString", coordinates: points.map((point) => [point.lng, point.lat]) };
}

export function routeDistanceMeters(points: LngLat[]) {
  if (points.length < 2) return 0;
  return lineDistanceMeters(routeGeometry(points));
}

export function lineDistanceMeters(geometry: LineString) {
  if (geometry.coordinates.length < 2) return 0;
  return Math.round(geometryDistanceMeters(geometry));
}

export type DayItems = {
  routes: RouteSegment[];
  photos: Photo[];
  notes: Note[];
  places: Place[];
};

// Collect every [lng, lat] coordinate from a day's items so callers can frame
// the map around them. Routes contribute each vertex of their LineString;
// points contribute their single coordinate. Photos may lack a location, so
// those are skipped.
export function collectItemCoordinates({ routes, photos, notes, places }: DayItems): [number, number][] {
  const coords: [number, number][] = [];
  for (const route of routes) {
    const geometry = route.geometry_geojson.type === "Feature" ? route.geometry_geojson.geometry : route.geometry_geojson;
    for (const position of geometry.coordinates) coords.push([position[0], position[1]]);
  }
  for (const photo of photos) {
    if (photo.lng !== null && photo.lat !== null) coords.push([photo.lng, photo.lat]);
  }
  for (const note of notes) coords.push([note.lng, note.lat]);
  for (const place of places) coords.push([place.lng, place.lat]);
  return coords;
}

export function routeFeatureCollection(routes: RouteSegment[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: routes.map((route) => {
      const geometry = (route.geometry_geojson.type === "Feature" ? route.geometry_geojson.geometry : route.geometry_geojson) as LineString;
      const routeDistanceKm = route.distance_meters
        ? route.distance_meters / 1000
        : geometryDistanceMeters(geometry) / 1000;
      const feature: Feature<LineString> = {
        type: "Feature",
        geometry,
        properties: {
          id: route.id,
          name: route.name ?? "Route segment",
          day_id: route.day_id,
          mode: route.mode,
          distance_km: routeDistanceKm,
        },
      };
      return feature;
    }),
  };
}

export function photoFeatureCollection(photos: Photo[]): FeatureCollection<Point> {
  return pointCollection(photos.filter((photo) => photo.lat !== null && photo.lng !== null).map((photo) => ({ ...photo, lat: photo.lat!, lng: photo.lng!, kind: "photo" })));
}

export function noteFeatureCollection(notes: Note[]): FeatureCollection<Point> {
  return pointCollection(notes.map((note) => ({ ...note, title: note.body, kind: "note" })));
}

export function placeFeatureCollection(places: Place[]): FeatureCollection<Point> {
  return pointCollection(places.map((place) => ({ ...place, title: place.name, kind: "place" })));
}

function pointCollection(items: Array<{ id: string; lng: number; lat: number; day_id: string | null; kind: string; [key: string]: unknown }>): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: items.map((item) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [item.lng, item.lat] },
      properties: item,
    })) as Feature<Point>[],
  };
}
