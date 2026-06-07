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
        map.addLayer({ id: "routes-shadow", type: "line", source: "routes", paint: { "line-color": "#26423b", "line-width": 8, "line-opacity": 0.28 } });
        map.addLayer({ id: "routes-line", type: "line", source: "routes", paint: { "line-color": ["match", ["get", "mode"], "ferry", "#2b8aa0", "bus", "#d0872f", "#0f766e"], "line-width": 4, "line-opacity": 0.95 } });
      } else {
        (map.getSource("routes") as mapboxgl.GeoJSONSource).setData(routeData);
      }

      if (!map.getSource("photos")) {
        map.addSource("photos", { type: "geojson", data: photoData });
        map.addLayer({ id: "photos-circle", type: "circle", source: "photos", paint: { "circle-radius": 9, "circle-color": "#fffdf6", "circle-stroke-width": 4, "circle-stroke-color": "#e7a13d" } });
      } else {
        (map.getSource("photos") as mapboxgl.GeoJSONSource).setData(photoData);
      }

      if (!map.getSource("notes")) {
        map.addSource("notes", { type: "geojson", data: noteData });
        map.addLayer({ id: "notes-circle", type: "circle", source: "notes", paint: { "circle-radius": 8, "circle-color": "#f6d28f", "circle-stroke-width": 3, "circle-stroke-color": "#7c4a14" } });
      } else {
        (map.getSource("notes") as mapboxgl.GeoJSONSource).setData(noteData);
      }

      if (!map.getSource("places")) {
        map.addSource("places", { type: "geojson", data: placeData });
        map.addLayer({ id: "places-circle", type: "circle", source: "places", paint: { "circle-radius": 8, "circle-color": "#c8e4d4", "circle-stroke-width": 3, "circle-stroke-color": "#0f5f55" } });
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
        ? `<div class="lofoten-popup-card lofoten-popup-card-photo"><img src="${escapeHtml(props.image_url)}" alt="Trip photo" class="lofoten-popup-image"/><div class="lofoten-popup-body"><div class="lofoten-popup-title">${escapeHtml(props.caption || "Untitled photo")}</div><div class="lofoten-popup-meta">${escapeHtml(formatDateTime(String(props.taken_at || props.created_at || "")))}</div></div></div>`
        : `<div class="lofoten-popup-card"><div class="lofoten-popup-body"><div class="lofoten-popup-title">${escapeHtml(props.title || props.body || props.name || "Map marker")}</div><div class="lofoten-popup-meta">${escapeHtml(props.description || props.note_type || "Shared trip marker")}</div></div></div>`;
      new mapboxgl.Popup({ offset: 18, className: "lofoten-popup" }).setLngLat(coordinates).setHTML(content).addTo(map!);
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
