"use client";

import mapboxgl from "mapbox-gl";
import { Expand, MapPin, Shrink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, LineString, Point } from "geojson";
import { LOFOTEN_CENTER, routeFeatureCollection } from "@/lib/geo";
import { bearingAlongLeg, legBetween, lerpBearing, offsetPoint, pointAlongLeg, type JourneyLeg } from "@/lib/journey-leg";
import { cn } from "@/lib/utils";
import type { JourneyItem } from "@/lib/journey";
import type { Day, LngLat, RouteSegment } from "@/types/trip";

type Props = {
  routes: RouteSegment[];
  days: Day[];
  items: JourneyItem[];
  activeItem: JourneyItem;
  onInteraction: () => void;
  onSelectItem: (id: string) => void;
};

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

function pointData(items: JourneyItem[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: items.flatMap((item) => item.coord ? [{
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [item.coord.lng, item.coord.lat] },
      properties: { id: item.id, kind: item.kind },
    }] : []),
  };
}

function activePointData(item: JourneyItem): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: item.coord ? [{
      type: "Feature",
      geometry: { type: "Point", coordinates: [item.coord.lng, item.coord.lat] },
      properties: { id: item.id },
    }] : [],
  };
}

// The camera tilts into the terrain while following a leg, reading like a
// hiker's view rather than a flat chart.
const FOLLOW_PITCH = 56;
// Free-camera flight parameters: the camera glides this high above the ground,
// trailing far enough behind the path point that, at FOLLOW_PITCH, the point
// sits centered in view (horizontal offset = height * tan(pitch)).
const CAMERA_HEIGHT_M = 800;
const CAMERA_TRAIL_KM = (CAMERA_HEIGHT_M * Math.tan((FOLLOW_PITCH * Math.PI) / 180)) / 1000;
// Legs longer than this (ferry hops, transfers) skip the ground-level walk and
// use Mapbox's arcing flyTo instead — panning 20km at hiking zoom is a blur.
const LONG_LEG_KM = 12;

function emptyLine(): FeatureCollection<LineString> {
  return { type: "FeatureCollection", features: [] };
}

function legCollection(leg: JourneyLeg | null): FeatureCollection<LineString> {
  if (!leg) return emptyLine();
  return { type: "FeatureCollection", features: [leg.line] };
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

function dayNumber(days: Day[], dayId: string | null) {
  if (!dayId) return null;
  return days.find((day) => day.id === dayId)?.day_number ?? null;
}

function progressedRoutes(routes: RouteSegment[], days: Day[], activeItem: JourneyItem) {
  const activeDayNumber = dayNumber(days, activeItem.dayId);
  if (activeDayNumber === null) return [];
  return routes.filter((route) => {
    const routeDayNumber = dayNumber(days, route.day_id);
    return routeDayNumber !== null && routeDayNumber <= activeDayNumber;
  });
}

export function JourneyMiniMap({ routes, days, items, activeItem, onInteraction, onSelectItem }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  // One closure tears down whatever stage the current flight is in (animation
  // frames, the post-flight idle listener, or the fallback timer).
  const flightCleanupRef = useRef<(() => void) | null>(null);
  const cancelFlight = useCallback(() => {
    flightCleanupRef.current?.();
    flightCleanupRef.current = null;
  }, []);
  // Long-lived popup/click closures read callbacks from this ref so the
  // attach-once click handler never needs to re-bind.
  const callbacksRef = useRef({ onInteraction, onSelectItem });
  useEffect(() => {
    callbacksRef.current = { onInteraction, onSelectItem };
  }, [onInteraction, onSelectItem]);
  const routeData = useMemo(() => routeFeatureCollection(routes), [routes]);
  const progressRouteData = useMemo(() => routeFeatureCollection(progressedRoutes(routes, days, activeItem)), [activeItem, days, routes]);
  const itemsData = useMemo(() => pointData(items), [items]);
  const activeData = useMemo(() => activePointData(activeItem), [activeItem]);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setUnavailable("Map token needed");
      return;
    }
    if (!mapboxgl.supported()) {
      setUnavailable("Map unavailable");
      return;
    }
    mapboxgl.accessToken = token;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/outdoors-v12",
        center: activeItem.coord ? [activeItem.coord.lng, activeItem.coord.lat] : LOFOTEN_CENTER,
        zoom: activeItem.coord ? 12.5 : 9.8,
        pitch: FOLLOW_PITCH,
        bearing: 0,
        attributionControl: false,
        interactive: true,
      });
    } catch {
      setUnavailable("Map unavailable");
      return;
    }
    // 3D terrain sells the hike: the fjords rise around the camera as it
    // follows the path. style.load (not load) so terrain survives style swaps.
    map.on("style.load", () => {
      if (map.getSource("mapbox-dem")) return;
      map.addSource("mapbox-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.35 });
    });
    // No NavigationControl: the zoom buttons crowd a map this small and read as
    // clutter. Pan/scroll/pinch still work for anyone who wants to explore.
    // Dev-only handle for inspecting camera state (pitch/zoom/terrain) from the
    // console or Playwright; the camera maths here have bitten us before.
    if (process.env.NODE_ENV !== "production") (window as unknown as { __miniMap?: mapboxgl.Map }).__miniMap = map;
    mapRef.current = map;
    // Keep the canvas in lockstep with the container as it animates between the
    // collapsed and expanded sizes. A one-shot resize would capture a mid-
    // transition size; the observer fires on every frame of the CSS transition.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Create the map instance exactly once. The initial center/zoom captures the
    // active item at mount; recentring as the active item changes is handled by
    // the easeTo effect below, so we must not tear the map down per navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // A user grabbing the map takes the camera back: stop any in-flight follow
    // animation so it doesn't wrestle the drag.
    const noteInteraction = () => {
      cancelFlight();
      onInteraction();
    };
    map.on("dragstart", noteInteraction);
    map.on("zoomstart", noteInteraction);
    map.on("rotatestart", noteInteraction);
    map.on("pitchstart", noteInteraction);
    return () => {
      map.off("dragstart", noteInteraction);
      map.off("zoomstart", noteInteraction);
      map.off("rotatestart", noteInteraction);
      map.off("pitchstart", noteInteraction);
    };
  }, [cancelFlight, onInteraction]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = "journey-items-circle";
    let attached = false;
    const handleClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      if (!id) return;
      callbacksRef.current.onInteraction();
      callbacksRef.current.onSelectItem(String(id));
    };
    const setPointer = () => map.getCanvas().style.setProperty("cursor", "pointer");
    const resetPointer = () => map.getCanvas().style.setProperty("cursor", "");
    // The dots layer is added asynchronously on style load, so attach as soon as
    // it exists (retrying on styledata) and then unsubscribe.
    const attach = () => {
      if (attached || !hasLayer(map, layer)) return;
      map.on("click", layer, handleClick);
      map.on("mouseenter", layer, setPointer);
      map.on("mouseleave", layer, resetPointer);
      attached = true;
      map.off("styledata", attach);
    };
    attach();
    if (!attached) map.on("styledata", attach);
    return () => {
      map.off("styledata", attach);
      if (!attached) return;
      map.off("click", layer, handleClick);
      map.off("mouseenter", layer, setPointer);
      map.off("mouseleave", layer, resetPointer);
    };
    // Attach once for the map's lifetime; callbacks come from callbacksRef.
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const addOrUpdate = () => {
      if (cancelled || !canUseStyle(map)) return;

      if (!getSource(map, "journey-routes")) {
        map.addSource("journey-routes", { type: "geojson", data: routeData });
        map.addLayer({ id: "journey-routes-shadow", type: "line", source: "journey-routes", paint: { "line-color": "#1c2f2b", "line-width": 7, "line-opacity": 0.24 } });
        map.addLayer({ id: "journey-routes-line", type: "line", source: "journey-routes", paint: { "line-color": "#fffdf6", "line-width": 3, "line-opacity": 0.85 } });
      } else {
        (getSource(map, "journey-routes") as mapboxgl.GeoJSONSource).setData(routeData);
      }

      if (!getSource(map, "journey-progress-routes")) {
        map.addSource("journey-progress-routes", { type: "geojson", data: progressRouteData });
        map.addLayer({ id: "journey-progress-line", type: "line", source: "journey-progress-routes", paint: { "line-color": "#e7a13d", "line-width": 4.5, "line-opacity": 0.95 } });
      } else {
        (getSource(map, "journey-progress-routes") as mapboxgl.GeoJSONSource).setData(progressRouteData);
      }

      if (!getSource(map, "journey-leg")) {
        // The leg the camera is currently walking; data is fed imperatively by
        // the flight effect, which owns when a leg starts and ends.
        map.addSource("journey-leg", { type: "geojson", data: emptyLine() });
        map.addLayer({ id: "journey-leg-line", type: "line", source: "journey-leg", layout: { "line-cap": "round" }, paint: { "line-color": "#ffd089", "line-width": 4, "line-dasharray": [0.2, 1.6], "line-opacity": 0.95 } });
      }

      if (!getSource(map, "journey-items")) {
        map.addSource("journey-items", { type: "geojson", data: itemsData });
        map.addLayer({ id: "journey-items-circle", type: "circle", source: "journey-items", paint: { "circle-radius": 4.5, "circle-color": "#fffdf6", "circle-stroke-width": 2, "circle-stroke-color": "#0f766e", "circle-opacity": 0.9 } });
      } else {
        (getSource(map, "journey-items") as mapboxgl.GeoJSONSource).setData(itemsData);
      }

      if (!getSource(map, "journey-active")) {
        map.addSource("journey-active", { type: "geojson", data: activeData });
        map.addLayer({ id: "journey-active-halo", type: "circle", source: "journey-active", paint: { "circle-radius": 18, "circle-color": "#e7a13d", "circle-opacity": 0.24 } });
        map.addLayer({ id: "journey-active-circle", type: "circle", source: "journey-active", paint: { "circle-radius": 9, "circle-color": "#fffdf6", "circle-stroke-width": 4, "circle-stroke-color": "#e7a13d" } });
      } else {
        (getSource(map, "journey-active") as mapboxgl.GeoJSONSource).setData(activeData);
      }
    };

    if (map.isStyleLoaded()) addOrUpdate();
    else map.once("load", addOrUpdate);
    return () => {
      cancelled = true;
      map.off("load", addOrUpdate);
    };
  }, [activeData, itemsData, progressRouteData, routeData]);

  // Follow the journey: when the active item changes, walk the camera along the
  // route between the previous item and this one, pitched into the terrain and
  // facing the direction of travel. Falls back to a plain ease for the first
  // item, reduced-motion users, and items with no location.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = activeItem.coord;
    // An item without a location keeps the camera where it is — but stop any
    // in-progress flight so it doesn't keep walking toward a stale target.
    if (!next) {
      cancelFlight();
      return;
    }
    cancelFlight();
    // Travel from wherever the camera actually is: identical to the previous
    // item after a completed flight, and free of snap-backs when a flight was
    // interrupted or the user panned away.
    const center = map.getCenter();
    const prev: LngLat = { lng: center.lng, lat: center.lat };

    const followZoom = expanded ? 13.6 : 12.8;
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const leg = reduceMotion ? null : legBetween(prev, next, routes);
    const setLegLine = (data: FeatureCollection<LineString>) => {
      const source = getSource(map, "journey-leg") as mapboxgl.GeoJSONSource | undefined;
      source?.setData(data);
    };

    // With terrain on, zoom is measured against the center's ground elevation,
    // which Mapbox updates asynchronously as DEM tiles load. Arriving over a
    // summit can therefore leave the camera re-expressed at a wildly different
    // zoom — even after a corrective ease, if the DEM tile lands later. So
    // instead of a one-shot fix, re-check at every "idle" (tiles loaded, all
    // transitions done) and re-ease while the zoom has drifted, with a cap so
    // a genuinely contested state can't loop forever.
    let normalizeAttempts = 0;
    const normalize = () => {
      if (normalizeAttempts >= 4) return;
      // Over elevated terrain a correctly-framed camera legitimately reads a
      // little below the target (zoom is ground-relative), so only step in for
      // gross drift like the summit re-expression (~5 levels), not the ~0.7
      // offset of an otherwise healthy arrival.
      if (Math.abs(map.getZoom() - followZoom) < 1.5) return;
      normalizeAttempts++;
      map.easeTo({ center: [next.lng, next.lat], zoom: followZoom, pitch: FOLLOW_PITCH, duration: 450, essential: true });
    };
    map.on("idle", normalize);
    let frameId = 0;
    flightCleanupRef.current = () => {
      cancelAnimationFrame(frameId);
      map.off("idle", normalize);
    };

    if (!leg || leg.lengthKm > LONG_LEG_KM) {
      setLegLine(legCollection(leg));
      if (leg) {
        // Too far to walk: arc over the leg instead, still facing travel-wards.
        map.flyTo({ center: [next.lng, next.lat], zoom: followZoom, pitch: FOLLOW_PITCH, bearing: bearingAlongLeg(leg, 1), maxDuration: 4500, essential: true });
      } else {
        map.easeTo({ center: [next.lng, next.lat], zoom: followZoom, pitch: FOLLOW_PITCH, duration: 900, essential: true });
      }
      return cancelFlight;
    }

    setLegLine(legCollection(leg));
    // Pace roughly with distance so short hops feel quick and long ones sweep,
    // clamped to stay inside the autoplay window.
    const duration = Math.min(3600, Math.max(1400, leg.lengthKm * 900));
    // Fly with the free-camera API: the camera is an explicit 3D position
    // (ground-hugging altitude, looking ahead along the path), so none of the
    // zoom-vs-ground-elevation re-expression that made jumpTo flights lurch
    // applies. The opening blend glides in from wherever the camera is now —
    // including a part-finished previous flight — instead of snapping.
    const startCamera = map.getFreeCameraOptions();
    const startLngLat = startCamera.position?.toLngLat() ?? { lng: prev.lng, lat: prev.lat };
    const startAltitude = startCamera.position?.toAltitude() ?? CAMERA_HEIGHT_M;
    const startPitch = map.getPitch();
    let ground = map.queryTerrainElevation([prev.lng, prev.lat]) ?? 0;
    let heading = map.getBearing();
    const startTime = performance.now();

    const frame = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeInOut(t);
      const blend = Math.min(1, t * 2.5);
      const pathPos = pointAlongLeg(leg, eased);
      // A generous bearing look-ahead plus a gentle lerp keeps switchbacks from
      // yawing the camera around; it banks through turns instead.
      heading = lerpBearing(heading, bearingAlongLeg(leg, eased, 0.25), 0.1);
      // Smooth the terrain sample so the camera doesn't step when DEM tiles
      // resolve; null (tile not loaded yet) just keeps the last known ground.
      const sampled = map.queryTerrainElevation([pathPos[0], pathPos[1]]);
      if (sampled != null) ground = lerp(ground, sampled, 0.12);
      // Chase-cam: trail behind the path point so it stays centered, at a fixed
      // pitch set explicitly — deriving orientation from a lookAt point made
      // the pitch swing with terrain height (lookAtPoint assumes altitude 0).
      const trail = offsetPoint(pathPos, CAMERA_TRAIL_KM, heading + 180);
      const camera = map.getFreeCameraOptions();
      camera.position = mapboxgl.MercatorCoordinate.fromLngLat(
        { lng: lerp(startLngLat.lng, trail[0], blend), lat: lerp(startLngLat.lat, trail[1], blend) },
        lerp(startAltitude, ground + CAMERA_HEIGHT_M, blend),
      );
      camera.setPitchBearing(lerp(startPitch, FOLLOW_PITCH, blend), heading);
      map.setFreeCameraOptions(camera);
      if (t < 1) {
        frameId = requestAnimationFrame(frame);
        return;
      }
      // Hand back to the regular camera with a closing ease onto the photo;
      // the idle normalizer above corrects any terrain re-expression after.
      map.easeTo({ center: [next.lng, next.lat], zoom: followZoom, pitch: FOLLOW_PITCH, bearing: heading, duration: 700, essential: true });
    };
    frameId = requestAnimationFrame(frame);
    return cancelFlight;
  }, [activeItem.coord, cancelFlight, expanded, routes]);

  function expand() {
    onInteraction();
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    setExpanded(true);
  }

  function queueCollapse() {
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = window.setTimeout(() => setExpanded(false), 700);
  }

  return (
    <div
      className={cn(
        "absolute right-3 top-16 z-40 overflow-hidden rounded-2xl border border-white/20 bg-stone-950/70 shadow-2xl transition-all duration-300 md:right-6 md:top-auto md:bottom-6",
        expanded ? "h-[min(62dvh,32rem)] w-[min(92vw,40rem)]" : "h-32 w-44 sm:h-48 sm:w-72",
      )}
      onMouseEnter={expand}
      onMouseLeave={queueCollapse}
    >
      <button type="button" onClick={() => (expanded ? setExpanded(false) : expand())} className="absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-950/55 text-white backdrop-blur transition hover:bg-stone-950/75 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30" aria-label={expanded ? "Collapse map" : "Expand map"}>
        {expanded ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
      </button>
      <div ref={containerRef} className="h-full w-full" onPointerDown={expand} />
      {unavailable ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#e7efe8] p-3 text-center text-xs font-bold text-stone-700">
          <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-teal-700" /> {activeItem.coord ? unavailable : "Location unknown"}</span>
        </div>
      ) : null}
      {!activeItem.coord && !unavailable ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 rounded-lg bg-[rgba(255,253,246,0.93)] px-2 py-1.5 text-center text-[11px] font-bold text-stone-700 shadow">
          Location unknown
        </div>
      ) : null}
    </div>
  );
}
