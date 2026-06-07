import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { length } from "@turf/turf";
import type { Note, Photo, Place, RouteSegment } from "@/types/trip";

export const LOFOTEN_CENTER: [number, number] = [13.0897, 67.9325];

export function routeFeatureCollection(routes: RouteSegment[]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features: routes.map((route) => {
      const geometry = (route.geometry_geojson.type === "Feature" ? route.geometry_geojson.geometry : route.geometry_geojson) as LineString;
      const distanceKm = route.distance_meters
        ? route.distance_meters / 1000
        : length({ type: "Feature", geometry, properties: {} }, { units: "kilometers" });
      const feature: Feature<LineString> = {
        type: "Feature",
        geometry,
        properties: {
          id: route.id,
          name: route.name ?? "Route segment",
          day_id: route.day_id,
          mode: route.mode,
          distance_km: distanceKm,
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
