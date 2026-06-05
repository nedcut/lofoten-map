"use client";

import mapboxgl from "mapbox-gl";
import { useEffect, useMemo } from "react";
import { noteFeatureCollection, photoFeatureCollection, placeFeatureCollection, routeFeatureCollection } from "@/lib/geo";
import { formatDateTime } from "@/lib/utils";
import type { Note, Photo, Place, RouteSegment } from "@/types/trip";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

type Props = {
  map: mapboxgl.Map | null;
  routes: RouteSegment[];
  photos: Photo[];
  notes: Note[];
  places: Place[];
  visibility: { routes: boolean; photos: boolean; notes: boolean };
};

export function TripLayers({ map, routes, photos, notes, places, visibility }: Props) {
  const routeData = useMemo(() => routeFeatureCollection(routes), [routes]);
  const photoData = useMemo(() => photoFeatureCollection(photos), [photos]);
  const noteData = useMemo(() => noteFeatureCollection(notes), [notes]);
  const placeData = useMemo(() => placeFeatureCollection(places), [places]);

  useEffect(() => {
    if (!map) return;

    const addOrUpdate = () => {
      if (!map.getSource("routes")) {
        map.addSource("routes", { type: "geojson", data: routeData });
        map.addLayer({ id: "routes-shadow", type: "line", source: "routes", paint: { "line-color": "#082f49", "line-width": 8, "line-opacity": 0.55 } });
        map.addLayer({ id: "routes-line", type: "line", source: "routes", paint: { "line-color": ["match", ["get", "mode"], "ferry", "#38bdf8", "bus", "#f59e0b", "#22d3ee"], "line-width": 4, "line-opacity": 0.95 } });
      } else {
        (map.getSource("routes") as mapboxgl.GeoJSONSource).setData(routeData);
      }

      if (!map.getSource("photos")) {
        map.addSource("photos", { type: "geojson", data: photoData });
        map.addLayer({ id: "photos-circle", type: "circle", source: "photos", paint: { "circle-radius": 9, "circle-color": "#f8fafc", "circle-stroke-width": 4, "circle-stroke-color": "#06b6d4" } });
      } else {
        (map.getSource("photos") as mapboxgl.GeoJSONSource).setData(photoData);
      }

      if (!map.getSource("notes")) {
        map.addSource("notes", { type: "geojson", data: noteData });
        map.addLayer({ id: "notes-circle", type: "circle", source: "notes", paint: { "circle-radius": 8, "circle-color": "#fde68a", "circle-stroke-width": 3, "circle-stroke-color": "#78350f" } });
      } else {
        (map.getSource("notes") as mapboxgl.GeoJSONSource).setData(noteData);
      }

      if (!map.getSource("places")) {
        map.addSource("places", { type: "geojson", data: placeData });
        map.addLayer({ id: "places-circle", type: "circle", source: "places", paint: { "circle-radius": 8, "circle-color": "#a7f3d0", "circle-stroke-width": 3, "circle-stroke-color": "#064e3b" } });
      } else {
        (map.getSource("places") as mapboxgl.GeoJSONSource).setData(placeData);
      }

      for (const id of ["routes-shadow", "routes-line"]) map.setLayoutProperty(id, "visibility", visibility.routes ? "visible" : "none");
      map.setLayoutProperty("photos-circle", "visibility", visibility.photos ? "visible" : "none");
      for (const id of ["notes-circle", "places-circle"]) map.setLayoutProperty(id, "visibility", visibility.notes ? "visible" : "none");
    };

    if (map.isStyleLoaded()) addOrUpdate();
    else map.once("load", addOrUpdate);
  }, [map, noteData, photoData, placeData, routeData, visibility]);

  useEffect(() => {
    if (!map) return;

    function showPopup(event: mapboxgl.MapLayerMouseEvent) {
      const feature = event.features?.[0];
      if (!feature || !feature.geometry || feature.geometry.type !== "Point") return;
      const props = feature.properties ?? {};
      const coordinates = (feature.geometry.coordinates as [number, number]).slice() as [number, number];
      const content = props.kind === "photo"
        ? `<div class="w-64"><img src="${escapeHtml(props.image_url)}" alt="Trip photo" class="h-36 w-full object-cover"/><div class="space-y-1 p-3"><div class="text-sm font-bold">${escapeHtml(props.caption || "Untitled photo")}</div><div class="text-xs text-slate-300">${escapeHtml(formatDateTime(String(props.taken_at || props.created_at || "")))}</div></div></div>`
        : `<div class="w-64 p-3"><div class="text-sm font-bold">${escapeHtml(props.title || props.body || props.name || "Map marker")}</div><div class="mt-1 text-xs text-slate-300">${escapeHtml(props.description || props.note_type || "Shared trip marker")}</div></div>`;
      new mapboxgl.Popup({ offset: 18 }).setLngLat(coordinates).setHTML(content).addTo(map!);
    }

    for (const layer of ["photos-circle", "notes-circle", "places-circle"]) {
      map.on("click", layer, showPopup);
      map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
    }

    return () => {
      for (const layer of ["photos-circle", "notes-circle", "places-circle"]) {
        map.off("click", layer, showPopup);
      }
    };
  }, [map]);

  return null;
}
