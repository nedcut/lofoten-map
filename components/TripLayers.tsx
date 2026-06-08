"use client";

import mapboxgl from "mapbox-gl";
import { useEffect, useMemo, useRef } from "react";
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

function canUseStyle(map: mapboxgl.Map) {
  try {
    return Boolean(map.getStyle());
  } catch {
    return false;
  }
}

function getSource(map: mapboxgl.Map, id: string) {
  if (!canUseStyle(map)) return undefined;
  try {
    return map.getSource(id);
  } catch {
    return undefined;
  }
}

function hasLayer(map: mapboxgl.Map, id: string) {
  if (!canUseStyle(map)) return false;
  try {
    return Boolean(map.getLayer(id));
  } catch {
    return false;
  }
}

function setLayerVisibility(map: mapboxgl.Map, id: string, visible: boolean) {
  if (!hasLayer(map, id)) return;
  map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

export type MapItemKind = "photo" | "note" | "place" | "route";

type Props = {
  map: mapboxgl.Map | null;
  routes: RouteSegment[];
  photos: Photo[];
  notes: Note[];
  places: Place[];
  visibility: { routes: boolean; photos: boolean; notes: boolean };
  currentUserId: string | null;
  isAdmin: boolean;
  onEditItem: (kind: MapItemKind, id: string) => void;
  onDeleteItem: (kind: MapItemKind, id: string) => void;
};

export function TripLayers({ map, routes, photos, notes, places, visibility, currentUserId, isAdmin, onEditItem, onDeleteItem }: Props) {
  // Popup click handlers are attached once (keyed on [map]); this ref lets those
  // long-lived closures read the latest permissions/callbacks without re-binding.
  const actionsRef = useRef({ currentUserId, isAdmin, onEditItem, onDeleteItem });
  useEffect(() => {
    actionsRef.current = { currentUserId, isAdmin, onEditItem, onDeleteItem };
  }, [currentUserId, isAdmin, onEditItem, onDeleteItem]);
  const routeData = useMemo(() => routeFeatureCollection(routes), [routes]);
  const photoData = useMemo(() => photoFeatureCollection(photos), [photos]);
  const noteData = useMemo(() => noteFeatureCollection(notes), [notes]);
  const placeData = useMemo(() => placeFeatureCollection(places), [places]);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const addOrUpdate = () => {
      if (cancelled || !canUseStyle(map)) return;

      if (!getSource(map, "routes")) {
        map.addSource("routes", { type: "geojson", data: routeData });
        map.addLayer({ id: "routes-shadow", type: "line", source: "routes", paint: { "line-color": "#26423b", "line-width": 8, "line-opacity": 0.28 } });
        map.addLayer({ id: "routes-line", type: "line", source: "routes", paint: { "line-color": ["match", ["get", "mode"], "ferry", "#2b8aa0", "bus", "#d0872f", "#0f766e"], "line-width": 4, "line-opacity": 0.95 } });
      } else {
        (getSource(map, "routes") as mapboxgl.GeoJSONSource).setData(routeData);
      }

      if (!getSource(map, "photos")) {
        map.addSource("photos", { type: "geojson", data: photoData });
        map.addLayer({ id: "photos-circle", type: "circle", source: "photos", paint: { "circle-radius": 9, "circle-color": "#fffdf6", "circle-stroke-width": 4, "circle-stroke-color": "#e7a13d" } });
      } else {
        (getSource(map, "photos") as mapboxgl.GeoJSONSource).setData(photoData);
      }

      if (!getSource(map, "notes")) {
        map.addSource("notes", { type: "geojson", data: noteData });
        map.addLayer({ id: "notes-circle", type: "circle", source: "notes", paint: { "circle-radius": 8, "circle-color": "#f6d28f", "circle-stroke-width": 3, "circle-stroke-color": "#7c4a14" } });
      } else {
        (getSource(map, "notes") as mapboxgl.GeoJSONSource).setData(noteData);
      }

      if (!getSource(map, "places")) {
        map.addSource("places", { type: "geojson", data: placeData });
        map.addLayer({ id: "places-circle", type: "circle", source: "places", paint: { "circle-radius": 8, "circle-color": "#c8e4d4", "circle-stroke-width": 3, "circle-stroke-color": "#0f5f55" } });
      } else {
        (getSource(map, "places") as mapboxgl.GeoJSONSource).setData(placeData);
      }

      for (const id of ["routes-shadow", "routes-line"]) setLayerVisibility(map, id, visibility.routes);
      setLayerVisibility(map, "photos-circle", visibility.photos);
      for (const id of ["notes-circle", "places-circle"]) setLayerVisibility(map, id, visibility.notes);
    };

    if (map.isStyleLoaded()) addOrUpdate();
    else map.once("load", addOrUpdate);

    return () => {
      cancelled = true;
      map.off("load", addOrUpdate);
    };
  }, [map, noteData, photoData, placeData, routeData, visibility]);

  useEffect(() => {
    if (!map) return;
    const activeMap = map;
    let handlersAttached = false;
    const pointPopupLayers = ["photos-circle", "notes-circle", "places-circle"];
    const routePopupLayer = "routes-line";

    function tag(kind: string) {
      return `<span class="lofoten-popup-tag lofoten-popup-tag-${kind}">${escapeHtml(kind)}</span>`;
    }

    // Owner-or-admin for photos/notes (they carry user_id); admin-only for
    // places/routes, which have no per-user ownership in the schema.
    function canManage(kind: MapItemKind, ownerId: string | null) {
      const { isAdmin: admin, currentUserId: viewerId } = actionsRef.current;
      if (admin) return true;
      if ((kind === "photo" || kind === "note") && ownerId && ownerId === viewerId) return true;
      return false;
    }

    // Inject Edit/Delete controls into a freshly-opened popup and route clicks to
    // the latest callbacks. Done in DOM (not HTML string) so listeners bind cleanly.
    function injectActions(popup: mapboxgl.Popup, kind: MapItemKind, id: string, ownerId: string | null) {
      if (!id || !canManage(kind, ownerId)) return;
      const body = popup.getElement()?.querySelector(".lofoten-popup-body");
      if (!body) return;
      const bar = document.createElement("div");
      bar.className = "lofoten-popup-actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "lofoten-popup-action";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => { popup.remove(); actionsRef.current.onEditItem(kind, id); });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "lofoten-popup-action lofoten-popup-action-danger";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => { popup.remove(); actionsRef.current.onDeleteItem(kind, id); });
      bar.append(editButton, deleteButton);
      body.append(bar);
    }

    function showPointPopup(event: mapboxgl.MapLayerMouseEvent) {
      const feature = event.features?.[0];
      if (!feature || !feature.geometry || feature.geometry.type !== "Point") return;
      const props = feature.properties ?? {};
      const coordinates = (feature.geometry.coordinates as [number, number]).slice() as [number, number];
      const byline = (person: unknown) => (person ? `<span class="lofoten-popup-by">by ${escapeHtml(person)}</span>` : "");

      let content: string;
      if (props.kind === "photo") {
        const meta = [formatDateTime(String(props.taken_at || props.created_at || "")), props.uploader_name ? `by ${props.uploader_name}` : ""].filter(Boolean).join(" · ");
        const imageUrl = props.thumbnail_url || props.image_url;
        content = `<div class="lofoten-popup-card lofoten-popup-card-photo"><img src="${escapeHtml(imageUrl)}" alt="Trip photo" class="lofoten-popup-image"/><div class="lofoten-popup-body">${tag("photo")}<div class="lofoten-popup-title">${escapeHtml(props.caption || "Untitled photo")}</div><div class="lofoten-popup-meta">${escapeHtml(meta)}</div></div></div>`;
      } else if (props.kind === "note") {
        content = `<div class="lofoten-popup-card"><div class="lofoten-popup-body">${tag("note")}<div class="lofoten-popup-title">${escapeHtml(props.body || props.title || "Trail note")}</div><div class="lofoten-popup-meta">${byline(props.author_name)}</div></div></div>`;
      } else {
        const meta = [props.place_type, props.description].filter(Boolean).map((value) => escapeHtml(value)).join(" · ");
        content = `<div class="lofoten-popup-card"><div class="lofoten-popup-body">${tag("place")}<div class="lofoten-popup-title">${escapeHtml(props.name || props.title || "Place")}</div><div class="lofoten-popup-meta">${meta || "Shared trip marker"}</div></div></div>`;
      }
      const popup = new mapboxgl.Popup({ offset: 18, className: "lofoten-popup" }).setLngLat(coordinates).setHTML(content).addTo(activeMap);
      injectActions(popup, props.kind as MapItemKind, String(props.id ?? ""), (props.user_id as string | null) ?? null);
    }

    function showRoutePopup(event: mapboxgl.MapLayerMouseEvent) {
      const feature = event.features?.[0];
      if (!feature) return;
      const props = feature.properties ?? {};
      const distanceKm = Number(props.distance_km);
      const meta = [
        props.mode ? String(props.mode) : null,
        Number.isFinite(distanceKm) ? `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km` : null,
      ].filter(Boolean).join(" · ");
      const content = `<div class="lofoten-popup-card"><div class="lofoten-popup-body">${tag("route")}<div class="lofoten-popup-title">${escapeHtml(props.name || "Route segment")}</div><div class="lofoten-popup-meta">${escapeHtml(meta || "Saved route")}</div></div></div>`;
      const popup = new mapboxgl.Popup({ offset: 18, className: "lofoten-popup" }).setLngLat(event.lngLat).setHTML(content).addTo(activeMap);
      injectActions(popup, "route", String(props.id ?? ""), null);
    }

    function setPointerCursor() {
      activeMap.getCanvas().style.setProperty("cursor", "pointer");
    }

    function resetPointerCursor() {
      activeMap.getCanvas().style.setProperty("cursor", "");
    }

    function attachHandlers() {
      if (handlersAttached || !pointPopupLayers.every((layer) => hasLayer(activeMap, layer)) || !hasLayer(activeMap, routePopupLayer)) return;
      for (const layer of pointPopupLayers) {
        activeMap.on("click", layer, showPointPopup);
        activeMap.on("mouseenter", layer, setPointerCursor);
        activeMap.on("mouseleave", layer, resetPointerCursor);
      }
      activeMap.on("click", routePopupLayer, showRoutePopup);
      activeMap.on("mouseenter", routePopupLayer, setPointerCursor);
      activeMap.on("mouseleave", routePopupLayer, resetPointerCursor);
      handlersAttached = true;
      activeMap.off("styledata", attachHandlers);
    }

    // Attach as soon as the layers exist. We deliberately do NOT gate on
    // isStyleLoaded()/once("load"): the sibling effect adds GeoJSON sources,
    // which flips isStyleLoaded() to false, and "load" has already fired — so a
    // once("load") here would never run. Retry on "styledata" until the layers
    // are present, then attachHandlers() unsubscribes itself.
    attachHandlers();
    if (!handlersAttached) activeMap.on("styledata", attachHandlers);

    return () => {
      activeMap.off("styledata", attachHandlers);
      if (!handlersAttached) return;
      for (const layer of pointPopupLayers) {
        activeMap.off("click", layer, showPointPopup);
        activeMap.off("mouseenter", layer, setPointerCursor);
        activeMap.off("mouseleave", layer, resetPointerCursor);
      }
      activeMap.off("click", routePopupLayer, showRoutePopup);
      activeMap.off("mouseenter", routePopupLayer, setPointerCursor);
      activeMap.off("mouseleave", routePopupLayer, resetPointerCursor);
    };
  }, [map]);

  return null;
}
