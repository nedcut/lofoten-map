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
  onOpenJourney: (photoId: string) => void;
  onPhotoFocus: (photoId: string) => void;
  onPhotoBlur: (photoId: string) => void;
};

export function TripLayers({ map, routes, photos, notes, places, visibility, currentUserId, isAdmin, onEditItem, onDeleteItem, onOpenJourney, onPhotoFocus, onPhotoBlur }: Props) {
  // Popup click handlers are attached once (keyed on [map]); this ref lets those
  // long-lived closures read the latest permissions/callbacks without re-binding.
  const actionsRef = useRef({ currentUserId, isAdmin, onEditItem, onDeleteItem, onOpenJourney, onPhotoFocus, onPhotoBlur });
  useEffect(() => {
    actionsRef.current = { currentUserId, isAdmin, onEditItem, onDeleteItem, onOpenJourney, onPhotoFocus, onPhotoBlur };
  }, [currentUserId, isAdmin, onEditItem, onDeleteItem, onOpenJourney, onPhotoFocus, onPhotoBlur]);
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
        map.addSource("photos", {
          type: "geojson",
          data: photoData,
          cluster: true,
          clusterMaxZoom: 17,
          clusterRadius: 64,
        });
        // This transparent layer gives queryRenderedFeatures a viewport-aware
        // view of both clusters and individual photos. The visible markers are
        // HTML thumbnails managed below.
        map.addLayer({
          id: "photos-hit",
          type: "circle",
          source: "photos",
          paint: { "circle-radius": 28, "circle-opacity": 0 },
        });
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
      setLayerVisibility(map, "photos-hit", visibility.photos);
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
    const markers = new Map<string, mapboxgl.Marker>();
    const photosById = new Map(photos.map((photo) => [photo.id, photo]));
    let frame = 0;

    function addPopupActions(popup: mapboxgl.Popup, photo: Photo) {
      const body = popup.getElement()?.querySelector(".lofoten-popup-body");
      if (!body) return;

      const journeyBar = document.createElement("div");
      journeyBar.className = "lofoten-popup-actions";
      const journeyButton = document.createElement("button");
      journeyButton.type = "button";
      journeyButton.className = "lofoten-popup-action lofoten-popup-action-journey";
      journeyButton.textContent = photo.media_type === "video" ? "Play video" : "Open in Journey";
      journeyButton.addEventListener("click", () => {
        popup.remove();
        actionsRef.current.onOpenJourney(photo.id);
      });
      journeyBar.append(journeyButton);
      body.append(journeyBar);

      const { isAdmin: admin, currentUserId: viewerId } = actionsRef.current;
      if (!admin && (!photo.user_id || photo.user_id !== viewerId)) return;
      const manageBar = document.createElement("div");
      manageBar.className = "lofoten-popup-actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "lofoten-popup-action";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => {
        popup.remove();
        actionsRef.current.onEditItem("photo", photo.id);
      });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "lofoten-popup-action lofoten-popup-action-danger";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        popup.remove();
        actionsRef.current.onDeleteItem("photo", photo.id);
      });
      manageBar.append(editButton, deleteButton);
      body.append(manageBar);
    }

    function showPhotoPopup(photo: Photo) {
      if (photo.lng === null || photo.lat === null) return;
      const meta = [
        formatDateTime(photo.taken_at || photo.created_at),
        photo.uploader_name ? `by ${photo.uploader_name}` : "",
      ].filter(Boolean).join(" · ");
      const imageUrl = photo.media_type === "video" ? photo.thumbnail_url : (photo.thumbnail_url || photo.image_url);
      const mediaLabel = photo.media_type === "video" ? "video" : "photo";
      const image = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="Trip ${mediaLabel}" class="lofoten-popup-image"/>`
        : photo.media_type === "video"
          ? `<div class="lofoten-popup-image lofoten-popup-video-fallback">Video</div>`
          : "";
      const content = `<div class="lofoten-popup-card lofoten-popup-card-photo">${image}<div class="lofoten-popup-body"><span class="lofoten-popup-tag lofoten-popup-tag-photo">${mediaLabel}</span><div class="lofoten-popup-title">${escapeHtml(photo.caption || `Untitled ${mediaLabel}`)}</div><div class="lofoten-popup-meta">${escapeHtml(meta)}</div></div></div>`;
      const popup = new mapboxgl.Popup({ offset: 34, className: "lofoten-popup", maxWidth: "17rem" })
        .setLngLat([photo.lng, photo.lat])
        .setHTML(content)
        .addTo(activeMap);
      addPopupActions(popup, photo);
      // The photo counts as "focused" only while its popup is open; dismissing
      // the popup hands journey-start priority back to the selected day.
      actionsRef.current.onPhotoFocus(photo.id);
      popup.on("close", () => actionsRef.current.onPhotoBlur(photo.id));
    }

    function closestPhoto(coordinates: [number, number]) {
      let closest: Photo | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const photo of photos) {
        if (photo.lng === null || photo.lat === null) continue;
        const lngDistance = (photo.lng - coordinates[0]) * Math.cos((photo.lat * Math.PI) / 180);
        const latDistance = photo.lat - coordinates[1];
        const distance = lngDistance * lngDistance + latDistance * latDistance;
        if (distance < closestDistance) {
          closest = photo;
          closestDistance = distance;
        }
      }
      return closest;
    }

    function createMarkerElement(photo: Photo, count: number) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `lofoten-photo-marker${count > 1 ? " lofoten-photo-marker-cluster" : ""}`;
      const mediaNoun = photo.media_type === "video" ? "video" : "photo";
      element.setAttribute("aria-label", count > 1 ? `View cluster of ${count} media items` : `View ${photo.caption || `trip ${mediaNoun}`}`);
      const imageUrl = photo.media_type === "video" ? photo.thumbnail_url : (photo.thumbnail_url || photo.image_url);
      if (imageUrl) {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = "";
        image.draggable = false;
        element.append(image);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "lofoten-photo-marker-fallback";
        fallback.textContent = photo.media_type === "video" ? "Video" : "Photo";
        element.append(fallback);
      }
      if (count > 1) {
        const badge = document.createElement("span");
        badge.className = "lofoten-photo-marker-count";
        badge.textContent = count > 999 ? "999+" : String(count);
        element.append(badge);
      }
      return element;
    }

    function refreshMarkers() {
      if (!visibility.photos || !hasLayer(activeMap, "photos-hit")) {
        for (const marker of markers.values()) marker.remove();
        markers.clear();
        return;
      }

      const features = activeMap.queryRenderedFeatures({ layers: ["photos-hit"] });
      const seen = new Set<string>();
      const canvas = activeMap.getCanvas();
      for (const feature of features) {
        if (!feature.geometry || feature.geometry.type !== "Point") continue;
        const coordinates = feature.geometry.coordinates as [number, number];
        const projected = activeMap.project(coordinates);
        if (projected.x < -36 || projected.y < -36 || projected.x > canvas.clientWidth + 36 || projected.y > canvas.clientHeight + 36) continue;
        const clusterId = Number(feature.properties?.cluster_id);
        const isCluster = Boolean(feature.properties?.cluster);
        const photo = isCluster
          ? closestPhoto(coordinates)
          : photosById.get(String(feature.properties?.id ?? ""));
        if (!photo) continue;
        const key = isCluster ? `cluster-${clusterId}` : `photo-${photo.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (!markers.has(key)) {
          const count = isCluster ? Number(feature.properties?.point_count) : 1;
          const element = createMarkerElement(photo, count);
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            if (!isCluster) {
              showPhotoPopup(photo);
              return;
            }
            const source = getSource(activeMap, "photos") as mapboxgl.GeoJSONSource | undefined;
            source?.getClusterExpansionZoom(clusterId, (error, zoom) => {
              if (error || zoom === null || zoom === undefined) return;
              activeMap.easeTo({ center: coordinates, zoom, duration: 550 });
            });
          });
          const marker = new mapboxgl.Marker({ element, anchor: "center" }).setLngLat(coordinates).addTo(activeMap);
          // Mapbox defaults custom markers to role="img"; these markers are
          // genuine controls, so restore the button semantics after creation.
          element.setAttribute("role", "button");
          markers.set(key, marker);
        } else {
          markers.get(key)?.setLngLat(coordinates);
        }
      }

      for (const [key, marker] of markers) {
        if (seen.has(key)) continue;
        marker.remove();
        markers.delete(key);
      }
    }

    function scheduleRefresh() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(refreshMarkers);
    }

    scheduleRefresh();
    activeMap.on("moveend", scheduleRefresh);
    activeMap.on("zoomend", scheduleRefresh);
    activeMap.on("sourcedata", scheduleRefresh);

    return () => {
      window.cancelAnimationFrame(frame);
      activeMap.off("moveend", scheduleRefresh);
      activeMap.off("zoomend", scheduleRefresh);
      activeMap.off("sourcedata", scheduleRefresh);
      for (const marker of markers.values()) marker.remove();
    };
  }, [map, photos, visibility.photos]);

  useEffect(() => {
    if (!map) return;
    const activeMap = map;
    let handlersAttached = false;
    const pointPopupLayers = ["notes-circle", "places-circle"];
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
      if (props.kind === "note") {
        content = `<div class="lofoten-popup-card"><div class="lofoten-popup-body">${tag("note")}<div class="lofoten-popup-title">${escapeHtml(props.body || props.title || "Trail note")}</div><div class="lofoten-popup-meta">${byline(props.author_name)}</div></div></div>`;
      } else {
        const meta = [props.place_type, props.description].filter(Boolean).map((value) => escapeHtml(value)).join(" · ");
        content = `<div class="lofoten-popup-card"><div class="lofoten-popup-body">${tag("place")}<div class="lofoten-popup-title">${escapeHtml(props.name || props.title || "Place")}</div><div class="lofoten-popup-meta">${meta || "Shared trip marker"}</div></div></div>`;
      }
      const popup = new mapboxgl.Popup({ offset: 18, className: "lofoten-popup", maxWidth: "17rem" }).setLngLat(coordinates).setHTML(content).addTo(activeMap);
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
      const popup = new mapboxgl.Popup({ offset: 18, className: "lofoten-popup", maxWidth: "17rem" }).setLngLat(event.lngLat).setHTML(content).addTo(activeMap);
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
