"use client";

import mapboxgl from "mapbox-gl";
import { useEffect, useMemo, useRef } from "react";
import { dayColorFor } from "@/lib/day-colors";
import { friendlyPersonName } from "@/lib/display-name";
import { noteFeatureCollection, photoFeatureCollection, placeFeatureCollection, routeFeatureCollection } from "@/lib/geo";
import { PHOTO_CLUSTER_MAX_ZOOM, PHOTO_CLUSTER_RADIUS, photoMarkerPresentation } from "@/lib/map-presentation";
import { MOBILE_SHEET_HEIGHT_VAR } from "@/components/MobileSheet";
import { formatDateTime } from "@/lib/utils";
import type { Day, Note, Photo, Place, RouteSegment } from "@/types/trip";
import { canUseStyle } from "@/lib/map-style";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSource(map: mapboxgl.Map, id: string) {
  if (!canUseStyle(map)) return undefined;
  try {
    return map.getSource(id);
  } catch {
    return undefined;
  }
}

// After a popup opens, move focus into it (its first action button, or the
// body as a fallback) instead of leaving focus stranded on whatever was
// clicked/tapped underneath it.
function focusPopupContent(popup: mapboxgl.Popup) {
  const element = popup.getElement();
  if (!element) return;
  const action = element.querySelector<HTMLElement>(".lofoten-popup-action");
  if (action) {
    action.focus();
    return;
  }
  const body = element.querySelector<HTMLElement>(".lofoten-popup-body") ?? element;
  body.setAttribute("tabindex", "-1");
  body.focus();
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
  days: Day[];
  // Day id → accent colour, shared with the sidebar so a route or marker
  // badge on the map matches the card for its day.
  dayColors: Map<string, string>;
  visibility: { routes: boolean; photos: boolean; notes: boolean };
  currentUserId: string | null;
  isAdmin: boolean;
  onEditItem: (kind: MapItemKind, id: string) => void;
  onDeleteItem: (kind: MapItemKind, id: string) => void;
  onOpenJourney: (photoId: string) => void;
  onPhotoFocus: (photoId: string) => void;
  onPhotoBlur: (photoId: string) => void;
  onMovePhoto: (photoId: string, coordinate: { lng: number; lat: number }) => void;
  // The photo currently open in the editor, marked on the map with a pulsing
  // ring so it's obvious which marker is being edited.
  highlightedPhotoId: string | null;
  // A location-check preview: the flagged photo, its time-neighbor group,
  // and the suggested corrected position.
  outlierPreview: { photo: { lng: number; lat: number }; suggested: { lng: number; lat: number }; neighbors: Array<{ lng: number; lat: number }> } | null;
};

export function TripLayers({ map, routes, photos, notes, places, days, dayColors, visibility, currentUserId, isAdmin, onEditItem, onDeleteItem, onOpenJourney, onPhotoFocus, onPhotoBlur, onMovePhoto, highlightedPhotoId, outlierPreview }: Props) {
  // Popup click handlers are attached once (keyed on [map]); this ref lets those
  // long-lived closures read the latest permissions/callbacks without re-binding.
  const actionsRef = useRef({ currentUserId, isAdmin, onEditItem, onDeleteItem, onOpenJourney, onPhotoFocus, onPhotoBlur, onMovePhoto });
  useEffect(() => {
    actionsRef.current = { currentUserId, isAdmin, onEditItem, onDeleteItem, onOpenJourney, onPhotoFocus, onPhotoBlur, onMovePhoto };
  }, [currentUserId, isAdmin, onEditItem, onDeleteItem, onOpenJourney, onPhotoFocus, onPhotoBlur, onMovePhoto]);
  const routeData = useMemo(() => routeFeatureCollection(routes, dayColors), [dayColors, routes]);
  const photoData = useMemo(() => photoFeatureCollection(photos), [photos]);
  const noteData = useMemo(() => noteFeatureCollection(notes), [notes]);
  const placeData = useMemo(() => placeFeatureCollection(places), [places]);
  // The collection last handed to each source. setData re-parses (and for
  // photos re-clusters) in Mapbox's worker, so a source is only re-sent when
  // its own collection changed, not when a sibling or a layer toggle did.
  const sentDataRef = useRef(new Map<string, GeoJSON.FeatureCollection>());

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const sent = sentDataRef.current;
    const addOrUpdate = () => {
      if (cancelled || !canUseStyle(map)) return;

      if (!getSource(map, "routes")) {
        map.addSource("routes", { type: "geojson", data: routeData });
        map.addLayer({ id: "routes-shadow", type: "line", source: "routes", paint: { "line-color": "#26423b", "line-width": 8, "line-opacity": 0.28 } });
        // Colour says which day; the dash pattern says how it was travelled
        // (ferry crossings dashed, bus legs dotted, everything else solid).
        map.addLayer({
          id: "routes-line",
          type: "line",
          source: "routes",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#0f766e"],
            "line-width": 4,
            "line-opacity": 0.95,
            "line-dasharray": ["match", ["get", "mode"], "ferry", ["literal", [2, 1.6]], "bus", ["literal", [0.3, 1.6]], ["literal", [1, 0]]],
          },
        });
      } else if (sent.get("routes") !== routeData) {
        (getSource(map, "routes") as mapboxgl.GeoJSONSource).setData(routeData);
      }
      sent.set("routes", routeData);

      if (!getSource(map, "photos")) {
        map.addSource("photos", {
          type: "geojson",
          data: photoData,
          cluster: true,
          clusterMaxZoom: PHOTO_CLUSTER_MAX_ZOOM,
          clusterRadius: PHOTO_CLUSTER_RADIUS,
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
      } else if (sent.get("photos") !== photoData) {
        (getSource(map, "photos") as mapboxgl.GeoJSONSource).setData(photoData);
      }
      sent.set("photos", photoData);

      if (!getSource(map, "notes")) {
        map.addSource("notes", { type: "geojson", data: noteData });
        map.addLayer({ id: "notes-circle", type: "circle", source: "notes", paint: { "circle-radius": 8, "circle-color": "#f6d28f", "circle-stroke-width": 3, "circle-stroke-color": "#7c4a14" } });
      } else if (sent.get("notes") !== noteData) {
        (getSource(map, "notes") as mapboxgl.GeoJSONSource).setData(noteData);
      }
      sent.set("notes", noteData);

      if (!getSource(map, "places")) {
        map.addSource("places", { type: "geojson", data: placeData });
        map.addLayer({ id: "places-circle", type: "circle", source: "places", paint: { "circle-radius": 8, "circle-color": "#c8e4d4", "circle-stroke-width": 3, "circle-stroke-color": "#0f5f55" } });
      } else if (sent.get("places") !== placeData) {
        (getSource(map, "places") as mapboxgl.GeoJSONSource).setData(placeData);
      }
      sent.set("places", placeData);

      for (const id of ["routes-shadow", "routes-line"]) setLayerVisibility(map, id, visibility.routes);
      setLayerVisibility(map, "photos-hit", visibility.photos);
      for (const id of ["notes-circle", "places-circle"]) setLayerVisibility(map, id, visibility.notes);
    };

    // isStyleLoaded() is also false while any tiles are still loading, long
    // after "load" has fired, so gating on it would silently drop an update
    // that lands mid-pan. The style itself only needs to have loaded once.
    if (canUseStyle(map)) addOrUpdate();
    else map.once("load", addOrUpdate);

    return () => {
      cancelled = true;
      map.off("load", addOrUpdate);
    };
  }, [map, noteData, photoData, placeData, routeData, visibility]);

  useEffect(() => {
    if (!map) return;
    const activeMap = map;
    const markers = new Map<string, MarkerEntry>();
    const photosById = new Map(photos.map((photo) => [photo.id, photo]));
    let frame = 0;
    // The marker currently being dragged. refreshMarkers runs on every
    // sourcedata event (tiles load constantly), and without this guard it
    // would snap the dragged marker back to its source position — or remove
    // it outright — mid-drag, killing the drop before dragend can save it.
    let draggingKey: string | null = null;

    function addPopupActions(popup: mapboxgl.Popup, photo: Photo) {
      const body = popup.getElement()?.querySelector(".lofoten-popup-body");
      if (!body) return;

      const journeyBar = document.createElement("div");
      journeyBar.className = "lofoten-popup-actions";
      const journeyButton = document.createElement("button");
      journeyButton.type = "button";
      journeyButton.className = "lofoten-popup-action lofoten-popup-action-journey";
      journeyButton.textContent = photo.media_type === "video" ? "Play video" : "Relive from here";
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

    function showPhotoPopup(photo: Photo, triggerElement: HTMLElement | null) {
      if (photo.lng === null || photo.lat === null) return;
      const uploader = friendlyPersonName(photo.uploader_name);
      // Uncaptioned photos take their date as the title ("Untitled photo" told
      // the viewer nothing); the date only repeats in the meta line when a
      // caption occupies the title slot.
      const dateLabel = formatDateTime(photo.taken_at || photo.created_at);
      const title = photo.caption || dateLabel;
      const meta = [
        photo.caption ? dateLabel : "",
        uploader ? `by ${uploader}` : "",
      ].filter(Boolean).join(" · ");
      const position = photoPositionLabel(photo);
      const imageUrl = photo.media_type === "video" ? photo.thumbnail_url : (photo.thumbnail_url || photo.image_url);
      const mediaLabel = photo.media_type === "video" ? "video" : "photo";
      const image = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="Trip ${mediaLabel}" class="lofoten-popup-image"/>`
        : photo.media_type === "video"
          ? `<div class="lofoten-popup-image lofoten-popup-video-fallback">Video</div>`
          : "";
      const content = `<div class="lofoten-popup-card lofoten-popup-card-photo">${image}<div class="lofoten-popup-body"><span class="lofoten-popup-tag lofoten-popup-tag-photo">${mediaLabel}</span><div class="lofoten-popup-title">${escapeHtml(title)}</div>${meta ? `<div class="lofoten-popup-meta">${escapeHtml(meta)}</div>` : ""}${position ? `<div class="lofoten-popup-meta lofoten-popup-position">${escapeHtml(position)}</div>` : ""}</div></div>`;
      const popup = new mapboxgl.Popup({ offset: 34, className: "lofoten-popup", maxWidth: "17rem" })
        .setLngLat([photo.lng, photo.lat])
        .setHTML(content)
        .addTo(activeMap);
      addPopupActions(popup, photo);
      focusPopupContent(popup);
      // The photo counts as "focused" only while its popup is open; dismissing
      // the popup hands journey-start priority back to the selected day.
      actionsRef.current.onPhotoFocus(photo.id);
      popup.on("close", () => {
        actionsRef.current.onPhotoBlur(photo.id);
        if (triggerElement && document.contains(triggerElement)) triggerElement.focus();
      });
    }

    // "12 of 69 on Day 2": where this photo falls in its day's timeline. The
    // effect's `photos` prop is the current map filter, which always contains
    // the whole of any day it contains at all.
    function photoPositionLabel(photo: Photo) {
      if (!photo.day_id) return null;
      const day = days.find((entry) => entry.id === photo.day_id);
      if (!day) return null;
      const siblings = photos
        .filter((item) => item.day_id === photo.day_id)
        .sort((a, b) => (a.taken_at || a.created_at).localeCompare(b.taken_at || b.created_at));
      const index = siblings.findIndex((item) => item.id === photo.id);
      if (index < 0) return null;
      return `${index + 1} of ${siblings.length} on Day ${day.day_number}`;
    }

    function canManagePhoto(photo: Photo) {
      const { isAdmin: admin, currentUserId: viewerId } = actionsRef.current;
      return admin || Boolean(photo.user_id && photo.user_id === viewerId);
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

    // How long a departing marker fades before its element is dropped. A
    // marker that comes back within this window is simply un-faded.
    const LEAVE_MS = 160;

    type MarkerEntry = {
      marker: mapboxgl.Marker;
      element: HTMLButtonElement;
      badge: HTMLSpanElement | null;
      photo: Photo;
      isCluster: boolean;
      clusterId: number;
      coordinates: [number, number];
      leaveTimer: number;
    };

    function createMarkerElement(photo: Photo) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "lofoten-photo-marker";
      // The frame and count badge take the colour of the photo's day (see
      // map-overrides.css), matching the day card and route line.
      element.style.setProperty("--day-accent", dayColorFor(dayColors, photo.day_id));
      const imageUrl = photo.media_type === "video" ? photo.thumbnail_url : (photo.thumbnail_url || photo.image_url);
      if (imageUrl) {
        const image = document.createElement("img");
        image.src = imageUrl;
        image.alt = "";
        image.decoding = "async";
        image.draggable = false;
        element.append(image);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "lofoten-photo-marker-fallback";
        fallback.textContent = photo.media_type === "video" ? "Video" : "Photo";
        element.append(fallback);
      }
      return element;
    }

    // A marker element is keyed by the photo it shows, so the same thumbnail
    // survives a zoom that merges it into a cluster or splits it back out:
    // only the badge, label and drag permission change between the states.
    function applyMarkerState(entry: MarkerEntry, isCluster: boolean, count: number, zoom: number) {
      const { element, photo } = entry;
      const presentation = photoMarkerPresentation(zoom, count);
      element.classList.toggle("lofoten-photo-marker-cluster", presentation.isCluster);
      element.classList.toggle("lofoten-photo-marker-overview", presentation.isOverview);
      const mediaNoun = photo.media_type === "video" ? "video" : "photo";
      element.setAttribute("aria-label", isCluster ? `View cluster of ${count} media items` : `View ${photo.caption || `trip ${mediaNoun}`}`);
      if (isCluster) {
        if (!entry.badge) {
          entry.badge = document.createElement("span");
          entry.badge.className = "lofoten-photo-marker-count";
          element.append(entry.badge);
        }
        entry.badge.textContent = count > 999 ? "999+" : String(count);
      } else if (entry.badge) {
        entry.badge.remove();
        entry.badge = null;
      }
      // Owners and admins can drag a misplaced photo straight to where it
      // belongs; dropping it saves the new location. Clusters can't move.
      const draggable = !isCluster && canManagePhoto(photo);
      entry.marker.setDraggable(draggable);
      if (draggable) element.title = "Drag to move this photo";
      else element.removeAttribute("title");
      entry.isCluster = isCluster;
    }

    function createEntry(key: string, photo: Photo, coordinates: [number, number]): MarkerEntry {
      const element = createMarkerElement(photo);
      const marker = new mapboxgl.Marker({ element, anchor: "center" }).setLngLat(coordinates).addTo(activeMap);
      const entry: MarkerEntry = { marker, element, badge: null, photo, isCluster: false, clusterId: Number.NaN, coordinates, leaveTimer: 0 };
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!entry.isCluster) {
          // Viewers who can't edit have nothing to do in a popup but press
          // "Relive from here", so a tap goes straight into the viewer.
          // Owners and admins still get the popup with edit/delete.
          if (canManagePhoto(photo)) showPhotoPopup(photo, element);
          else actionsRef.current.onOpenJourney(photo.id);
          return;
        }
        const source = getSource(activeMap, "photos") as mapboxgl.GeoJSONSource | undefined;
        const target = entry.coordinates;
        source?.getClusterExpansionZoom(entry.clusterId, (error, zoom) => {
          if (error || zoom === null || zoom === undefined) return;
          activeMap.easeTo({ center: target, zoom, duration: 550 });
        });
      });
      marker.on("dragstart", () => {
        draggingKey = key;
      });
      marker.on("dragend", () => {
        draggingKey = null;
        const dropped = marker.getLngLat();
        actionsRef.current.onMovePhoto(photo.id, { lng: dropped.lng, lat: dropped.lat });
      });
      // Mapbox defaults custom markers to role="img"; these markers are
      // genuine controls, so restore the button semantics after creation.
      element.setAttribute("role", "button");
      return entry;
    }

    // On phones the bottom sheet covers the lower part of the canvas, so
    // markers under it are never visible and needn't exist.
    function sheetInset() {
      if (window.innerWidth >= 768) return 0;
      const height = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(MOBILE_SHEET_HEIGHT_VAR));
      return Number.isFinite(height) && height > 0 ? height : 0;
    }

    function dropEntry(key: string, entry: MarkerEntry) {
      window.clearTimeout(entry.leaveTimer);
      entry.marker.remove();
      markers.delete(key);
    }

    function refreshMarkers() {
      if (!visibility.photos || !hasLayer(activeMap, "photos-hit")) {
        for (const [key, entry] of markers) dropEntry(key, entry);
        return;
      }

      const features = activeMap.queryRenderedFeatures({ layers: ["photos-hit"] });
      const seen = new Set<string>();
      const canvas = activeMap.getCanvas();
      const zoom = activeMap.getZoom();
      // queryRenderedFeatures only returns viewport features, so new markers
      // cannot be created in this band. Already-mounted ones are kept so a
      // pan reveals thumbnails that are already in the DOM instead of
      // popping them in at the edge.
      const margin = 80;
      const bottomLimit = canvas.clientHeight - sheetInset() + margin;
      const inKeepAliveArea = (projected: { x: number; y: number }) =>
        projected.x >= -margin &&
        projected.y >= -margin &&
        projected.x <= canvas.clientWidth + margin &&
        projected.y <= bottomLimit;
      const setMarkerDepth = (entry: MarkerEntry, projected: { y: number }) => {
        entry.element.style.setProperty("--marker-depth", String(Math.max(0, Math.round(projected.y))));
      };
      for (const feature of features) {
        if (!feature.geometry || feature.geometry.type !== "Point") continue;
        const coordinates = feature.geometry.coordinates as [number, number];
        const projected = activeMap.project(coordinates);
        if (!inKeepAliveArea(projected)) continue;
        const clusterId = Number(feature.properties?.cluster_id);
        const isCluster = Boolean(feature.properties?.cluster);
        const count = isCluster ? Number(feature.properties?.point_count) : 1;
        const photo = isCluster
          ? closestPhoto(coordinates)
          : photosById.get(String(feature.properties?.id ?? ""));
        if (!photo) continue;
        // Two clusters can (rarely) pick the same nearest photo; the second
        // falls back to its cluster id rather than being dropped.
        let key = `photo-${photo.id}`;
        if (seen.has(key)) key = `cluster-${clusterId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let entry = markers.get(key);
        if (!entry) {
          entry = createEntry(key, photo, coordinates);
          markers.set(key, entry);
        } else if (entry.leaveTimer) {
          window.clearTimeout(entry.leaveTimer);
          entry.leaveTimer = 0;
          entry.element.classList.remove("lofoten-photo-marker-leaving");
        }
        entry.clusterId = clusterId;
        entry.coordinates = coordinates;
        // Screen Y as a CSS variable so nearer thumbnails overlap ones behind
        // without an inline z-index that would beat hover/focus.
        setMarkerDepth(entry, projected);
        if (key !== draggingKey) {
          applyMarkerState(entry, isCluster, count, zoom);
          entry.marker.setLngLat(coordinates);
        }
      }

      for (const [key, entry] of markers) {
        if (seen.has(key) || key === draggingKey) continue;
        const projected = activeMap.project(entry.coordinates);
        if (inKeepAliveArea(projected)) {
          if (entry.leaveTimer) {
            window.clearTimeout(entry.leaveTimer);
            entry.leaveTimer = 0;
            entry.element.classList.remove("lofoten-photo-marker-leaving");
          }
          setMarkerDepth(entry, projected);
          continue;
        }
        if (entry.leaveTimer) continue;
        entry.element.classList.add("lofoten-photo-marker-leaving");
        entry.leaveTimer = window.setTimeout(() => dropEntry(key, entry), LEAVE_MS);
      }
    }

    function scheduleRefresh() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(refreshMarkers);
    }

    // sourcedata also fires for every basemap tile that arrives; only the
    // photos source changes which clusters and markers exist. "idle" catches
    // anything that settles after the last photos event.
    function handleSourceData(event: mapboxgl.MapSourceDataEvent) {
      if (event.sourceId === "photos") scheduleRefresh();
    }

    scheduleRefresh();
    // Refreshing on every move (coalesced to one pass per animation frame)
    // means markers scrolling into view and clusters splitting or merging
    // show up while the map is still in motion, not only once it settles.
    // Mapbox keeps existing markers glued to their coordinates in between.
    activeMap.on("move", scheduleRefresh);
    activeMap.on("moveend", scheduleRefresh);
    activeMap.on("sourcedata", handleSourceData);
    activeMap.on("idle", scheduleRefresh);

    return () => {
      window.cancelAnimationFrame(frame);
      activeMap.off("move", scheduleRefresh);
      activeMap.off("moveend", scheduleRefresh);
      activeMap.off("sourcedata", handleSourceData);
      activeMap.off("idle", scheduleRefresh);
      for (const [key, entry] of markers) dropEntry(key, entry);
    };
  }, [map, photos, days, dayColors, visibility.photos]);

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
      const byline = (person: unknown) => {
        const name = friendlyPersonName(typeof person === "string" ? person : null);
        return name ? `<span class="lofoten-popup-by">by ${escapeHtml(name)}</span>` : "";
      };

      let content: string;
      if (props.kind === "note") {
        content = `<div class="lofoten-popup-card"><div class="lofoten-popup-body">${tag("note")}<div class="lofoten-popup-title">${escapeHtml(props.body || props.title || "Trail note")}</div><div class="lofoten-popup-meta">${byline(props.author_name)}</div></div></div>`;
      } else {
        const meta = [props.place_type, props.description].filter(Boolean).map((value) => escapeHtml(value)).join(" · ");
        content = `<div class="lofoten-popup-card"><div class="lofoten-popup-body">${tag("place")}<div class="lofoten-popup-title">${escapeHtml(props.name || props.title || "Place")}</div><div class="lofoten-popup-meta">${meta || "Shared trip marker"}</div></div></div>`;
      }
      const popup = new mapboxgl.Popup({ offset: 18, className: "lofoten-popup", maxWidth: "17rem" }).setLngLat(coordinates).setHTML(content).addTo(activeMap);
      injectActions(popup, props.kind as MapItemKind, String(props.id ?? ""), (props.user_id as string | null) ?? null);
      focusPopupContent(popup);
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
      focusPopupContent(popup);
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

  // A pulsing ring on the photo currently open in the editor, so the marker
  // being edited is unmistakable. A DOM marker (not a layer) so the CSS
  // animation runs without per-frame map renders. The ring is also draggable:
  // photos stacked at the same spot stay clustered at every zoom (clustering
  // is pixel-radius based), so the cluster thumbnail can't be dragged — but
  // the ring always targets exactly the photo being edited.
  useEffect(() => {
    if (!map) return;
    const photo = highlightedPhotoId ? photos.find((item) => item.id === highlightedPhotoId) : null;
    if (!photo || photo.lng === null || photo.lat === null) return;
    const element = document.createElement("div");
    element.className = "lofoten-photo-highlight";
    element.title = "Drag to move this photo";
    const ring = document.createElement("div");
    ring.className = "lofoten-photo-highlight-ring";
    element.append(ring);
    const marker = new mapboxgl.Marker({ element, anchor: "center", draggable: true }).setLngLat([photo.lng, photo.lat]).addTo(map);
    marker.on("dragend", () => {
      const dropped = marker.getLngLat();
      actionsRef.current.onMovePhoto(photo.id, { lng: dropped.lng, lat: dropped.lat });
    });
    return () => {
      marker.remove();
    };
  }, [highlightedPhotoId, map, photos]);

  // Location-check preview: a pulsing ring on the flagged photo, a dot on
  // each time-neighbor, a dashed ring at the suggested spot, and a line
  // connecting photo to suggestion. Drawn from the outlier data itself, so it
  // shows even when the day filter hides the photo's marker.
  useEffect(() => {
    if (!map || !outlierPreview) return;
    const { photo, suggested, neighbors } = outlierPreview;
    const markers: mapboxgl.Marker[] = [];

    const ringHost = document.createElement("div");
    ringHost.className = "lofoten-photo-highlight";
    ringHost.style.pointerEvents = "none";
    const ring = document.createElement("div");
    ring.className = "lofoten-photo-highlight-ring";
    ringHost.append(ring);
    markers.push(new mapboxgl.Marker({ element: ringHost, anchor: "center" }).setLngLat([photo.lng, photo.lat]).addTo(map));

    for (const neighbor of neighbors) {
      const dot = document.createElement("div");
      dot.className = "lofoten-outlier-neighbor";
      markers.push(new mapboxgl.Marker({ element: dot, anchor: "center" }).setLngLat([neighbor.lng, neighbor.lat]).addTo(map));
    }

    const center = document.createElement("div");
    center.className = "lofoten-outlier-center";
    markers.push(new mapboxgl.Marker({ element: center, anchor: "center" }).setLngLat([suggested.lng, suggested.lat]).addTo(map));

    const lineData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[photo.lng, photo.lat], [suggested.lng, suggested.lat]] }, properties: {} }],
    };
    const emptyLine: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const syncLine = () => {
      if (!canUseStyle(map)) return;
      try {
        const source = getSource(map, "outlier-preview") as mapboxgl.GeoJSONSource | undefined;
        if (source) source.setData(lineData);
        else map.addSource("outlier-preview", { type: "geojson", data: lineData });
        if (!hasLayer(map, "outlier-preview-line")) {
          map.addLayer({ id: "outlier-preview-line", type: "line", source: "outlier-preview", layout: { "line-cap": "round" }, paint: { "line-color": "#0f766e", "line-width": 2.5, "line-dasharray": [1.2, 1.8], "line-opacity": 0.85 } });
        }
      } catch {
        // A style load can still be between phases; the next style.load retries.
      }
    };
    syncLine();
    map.on("style.load", syncLine);

    return () => {
      map.off("style.load", syncLine);
      for (const marker of markers) marker.remove();
      (getSource(map, "outlier-preview") as mapboxgl.GeoJSONSource | undefined)?.setData(emptyLine);
    };
  }, [map, outlierPreview]);

  return null;
}
