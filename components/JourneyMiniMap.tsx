"use client";

import mapboxgl from "mapbox-gl";
import { MapPin, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, LineString, Point } from "geojson";
import { LOFOTEN_CENTER, routeFeatureCollection } from "@/lib/geo";
import { bearingAlongLeg, distanceKm, legBetween, lerpBearing, offsetPoint, pointAlongLeg, steerBearing, type JourneyLeg } from "@/lib/journey-leg";
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
const FOLLOW_PITCH = 50;
// Free-camera flight parameters: the camera glides this high above the ground,
// trailing far enough behind the path point that, at FOLLOW_PITCH, the point
// sits centered in view (horizontal offset = height * tan(pitch)). Height is
// generous so ridgelines between camera and subject stay below the view.
const CAMERA_HEIGHT_M = 1150;
const CAMERA_TRAIL_KM = (CAMERA_HEIGHT_M * Math.tan((FOLLOW_PITCH * Math.PI) / 180)) / 1000;
// The camera follows the route's *position* but only lightly its direction:
// per leg it turns at most this much toward the leg's overall bearing. Keeps
// switchbacks from yawing the view around and makes stepping backwards a calm
// reverse pan instead of a 180° spin.
const MAX_TURN_DEG = 30;
// Photos within this range of the last framed photo don't move the camera at
// all — a shift this small is GPS noise, and the active dot moving a few
// pixels communicates it better than a camera flight does.
const HOLD_RADIUS_KM = 0.08;
// ...but only while the user hasn't wandered off: if the map center has
// drifted beyond this from the last framed photo (manual pan, or an
// interrupted flight), stepping should bring the camera back.
const HOLD_MAX_WANDER_KM = 1.5;

// Collapsed-size presets the +/- buttons step through; the choice persists
// across sessions. Index 1 is the historical default.
const COLLAPSED_SIZES = [
  "h-24 w-36 sm:h-36 sm:w-56",
  "h-32 w-44 sm:h-48 sm:w-72",
  "h-44 w-60 sm:h-60 sm:w-96",
  "h-56 w-[19rem] sm:h-72 sm:w-[30rem]",
];
const SIZE_STORAGE_KEY = "lofoten-minimap-size";

function storedSizeIndex() {
  if (typeof window === "undefined") return 1;
  const raw = window.localStorage.getItem(SIZE_STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < COLLAPSED_SIZES.length ? parsed : 1;
}
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
  const [sizeIndex, setSizeIndex] = useState(storedSizeIndex);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  // Resizing grows the box toward the cursor (it's bottom-anchored on
  // desktop), which would fire hover-expand mid-adjustment; suppress briefly.
  const sizeChangedAtRef = useRef(0);
  // One closure tears down whatever stage the current flight is in (animation
  // frames, the post-flight idle listener, or the fallback timer).
  const flightCleanupRef = useRef<(() => void) | null>(null);
  // The coordinate the camera last flew to, so near-identical photo positions
  // (GPS noise apart) can hold the camera still instead of nudging it.
  const lastTargetRef = useRef<LngLat | null>(null);
  // True while a free-camera flight is mid-air. The hold-still shortcut must
  // not engage then: rapid steps interrupt the flight, and holding against a
  // target the camera never reached would freeze it mid-leg.
  const flightActiveRef = useRef(false);
  // Monotonic flight generation. Every animation callback checks it belongs
  // to the current generation before doing anything: under rapid stepping,
  // cancelAnimationFrame can race the frame that re-arms the loop, leaving a
  // zombie flight steering the camera toward a stale photo. The generation
  // check makes a surviving callback exit instead.
  const flightGenRef = useRef(0);
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
      flightGenRef.current++;
      return;
    }
    // Captured before cancelFlight: is the camera mid-motion (our rAF flight,
    // or a Mapbox ease/fly still animating)? Holding still is only valid from
    // a settled camera that genuinely frames the previous target.
    const inMotion = flightActiveRef.current || map.isMoving();
    // Travel from wherever the camera actually is: identical to the previous
    // item after a completed flight, and free of snap-backs when a flight was
    // interrupted or the user panned away.
    const center = map.getCenter();
    const prev: LngLat = { lng: center.lng, lat: center.lat };
    const setLegLine = (data: FeatureCollection<LineString>) => {
      const source = getSource(map, "journey-leg") as mapboxgl.GeoJSONSource | undefined;
      source?.setData(data);
    };

    // Hold still for GPS-noise hops: when the next photo is within a few dozen
    // meters of the last one the camera framed (and the view hasn't wandered
    // off it), moving the map communicates nothing — the active dot shifting a
    // few pixels does. The anchor stays put across held steps so a chain of
    // tiny hops can't slowly walk the camera away.
    const lastTarget = lastTargetRef.current;
    if (
      !inMotion
      && lastTarget
      && distanceKm(lastTarget, next) < HOLD_RADIUS_KM
      && distanceKm(lastTarget, prev) < HOLD_MAX_WANDER_KM
    ) {
      cancelFlight();
      flightGenRef.current++;
      setLegLine(emptyLine());
      return;
    }
    cancelFlight();
    const generation = ++flightGenRef.current;
    // Kill any Mapbox-driven animation (the opening ease, a long-leg flyTo):
    // it would otherwise keep writing the camera every frame in parallel with
    // the new flight — and win, carrying the view to the stale target.
    map.stop();
    // The anchor records *completed* arrivals only. It is cleared here and
    // re-set when motion finishes, so an interrupted flight (rapid steps, a
    // location-less item mid-burst) can never convince the hold logic that
    // the camera is somewhere it never actually arrived.
    lastTargetRef.current = null;

    const followZoom = expanded ? 13.6 : 12.8;
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const leg = reduceMotion ? null : legBetween(prev, next, routes);

    // With terrain on, every zoom-based camera write races Mapbox's async
    // center-elevation updates — over a summit, "zoom 12.8" can be placed
    // relative to sea level and park the camera meters off the deck. So the
    // arrival check works in altitude space instead: at every "idle" (tiles
    // loaded, transitions done), verify the camera's clearance above the
    // photo's ground, and when it's unhealthy glide the free camera back to
    // the canonical pose — never via zoom, which would re-enter the race.
    let normalizeAttempts = 0;
    let normalizeFrame = 0;
    const normalize = () => {
      if (flightGenRef.current !== generation) return;
      if (normalizeAttempts >= 3) return;
      const camNow = map.getFreeCameraOptions();
      const altNow = camNow.position?.toAltitude();
      const camLngLat = camNow.position?.toLngLat();
      const photoGround = map.queryTerrainElevation([next.lng, next.lat]);
      if (altNow == null || !camLngLat || photoGround == null) return;
      // Clearance against the higher of the photo's ground and the camera's
      // own ground: the camera trails behind the photo and can sit over a
      // ridge well above it — "fine above the photo" can still scrape terrain.
      const cameraGround = map.queryTerrainElevation(camLngLat) ?? photoGround;
      const clearance = altNow - Math.max(photoGround, cameraGround);
      if (clearance >= 500 && clearance <= 2600) return;
      normalizeAttempts++;
      const fromLngLat = camNow.position?.toLngLat() ?? { lng: next.lng, lat: next.lat };
      const fromAlt = altNow;
      const bearingNow = map.getBearing();
      const pitchNow = map.getPitch();
      const trail = offsetPoint([next.lng, next.lat], CAMERA_TRAIL_KM, bearingNow + 180);
      const targetAlt = photoGround + CAMERA_HEIGHT_M;
      const begin = performance.now();
      const glide = (now: number) => {
        if (flightGenRef.current !== generation) return;
        const gt = Math.min(1, (now - begin) / 450);
        const k = easeInOut(gt);
        const cam = map.getFreeCameraOptions();
        cam.position = mapboxgl.MercatorCoordinate.fromLngLat(
          { lng: lerp(fromLngLat.lng, trail[0], k), lat: lerp(fromLngLat.lat, trail[1], k) },
          lerp(fromAlt, targetAlt, k),
        );
        cam.setPitchBearing(lerp(pitchNow, FOLLOW_PITCH, k), bearingNow);
        map.setFreeCameraOptions(cam);
        if (gt < 1) normalizeFrame = requestAnimationFrame(glide);
      };
      cancelAnimationFrame(normalizeFrame);
      normalizeFrame = requestAnimationFrame(glide);
    };
    map.on("idle", normalize);
    let frameId = 0;
    flightCleanupRef.current = () => {
      flightActiveRef.current = false;
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(normalizeFrame);
      map.off("idle", normalize);
    };

    if (!leg || leg.lengthKm > LONG_LEG_KM) {
      setLegLine(legCollection(leg));
      if (leg) {
        // Too far to walk: arc over the leg instead, turning only lightly.
        map.flyTo({ center: [next.lng, next.lat], zoom: followZoom, pitch: FOLLOW_PITCH, bearing: steerBearing(map.getBearing(), bearingAlongLeg(leg, 1), MAX_TURN_DEG), maxDuration: 4500, essential: true });
      } else {
        map.easeTo({ center: [next.lng, next.lat], zoom: followZoom, pitch: FOLLOW_PITCH, duration: 900, essential: true });
      }
      // Safe to anchor optimistically: if this animation is interrupted, the
      // next effect run clears the anchor before the hold logic can read it.
      lastTargetRef.current = next;
      return cancelFlight;
    }

    setLegLine(legCollection(leg));
    // Pace roughly with distance so short hops feel quick and long ones sweep,
    // clamped to stay inside the autoplay window.
    const duration = Math.min(3800, Math.max(1600, leg.lengthKm * 1000));
    // Fly with the free-camera API: the camera is an explicit 3D position
    // (ground-hugging altitude at fixed pitch), so none of the
    // zoom-vs-ground-elevation re-expression that made jumpTo flights lurch
    // applies. The opening blend glides in from wherever the camera is now —
    // including a part-finished previous flight — instead of snapping.
    const startCamera = map.getFreeCameraOptions();
    const startLngLat = startCamera.position?.toLngLat() ?? { lng: prev.lng, lat: prev.lat };
    const startAltitude = startCamera.position?.toAltitude() ?? CAMERA_HEIGHT_M;
    const startPitch = map.getPitch();
    // One heading decision per leg: turn at most MAX_TURN_DEG toward the leg's
    // overall direction, then ease monotonically onto it. No per-frame route
    // tracking — the position follows the trail; the orientation stays calm.
    const startBearing = map.getBearing();
    const targetHeading = steerBearing(startBearing, bearingAlongLeg(leg, 0, leg.lengthKm), MAX_TURN_DEG);
    let ground = map.queryTerrainElevation([prev.lng, prev.lat]) ?? 0;
    const startTime = performance.now();

    const frame = (now: number) => {
      if (flightGenRef.current !== generation) return;
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeInOut(t);
      const blend = Math.min(1, t * 2.5);
      const heading = lerpBearing(startBearing, targetHeading, easeInOut(t));
      const pathPos = pointAlongLeg(leg, eased);
      const trail = offsetPoint(pathPos, CAMERA_TRAIL_KM, heading + 180);
      // Ride above the higher of the ground under the camera and under the
      // subject, smoothed so DEM tiles resolving mid-flight don't step the
      // altitude — this is what keeps ridgelines from swallowing the view.
      // Asymmetric: climb quickly when ground rises toward the camera, sink
      // back lazily, like a drone clearing a ridge.
      const sampled = [
        map.queryTerrainElevation([trail[0], trail[1]]),
        map.queryTerrainElevation([pathPos[0], pathPos[1]]),
      ].filter((value): value is number => value != null);
      if (sampled.length > 0) {
        const target = Math.max(...sampled);
        ground = lerp(ground, target, target > ground ? 0.35 : 0.06);
      }
      const camera = map.getFreeCameraOptions();
      camera.position = mapboxgl.MercatorCoordinate.fromLngLat(
        { lng: lerp(startLngLat.lng, trail[0], blend), lat: lerp(startLngLat.lat, trail[1], blend) },
        lerp(startAltitude, ground + CAMERA_HEIGHT_M, blend),
      );
      camera.setPitchBearing(lerp(startPitch, FOLLOW_PITCH, blend), heading);
      map.setFreeCameraOptions(camera);
      if (t < 1) {
        frameId = requestAnimationFrame(frame);
      } else {
        flightActiveRef.current = false;
        // Arrival completed: this is the only moment the camera verifiably
        // frames the photo, so only now does it become the hold anchor.
        lastTargetRef.current = next;
      }
      // No closing ease: the flight's final frame already poses the camera on
      // the photo, and any zoom-based hand-back races Mapbox's async center
      // elevation over terrain — the very lurch this flight exists to avoid.
      // The idle normalizer corrects the pose if anything still lands badly.
    };
    flightActiveRef.current = true;
    frameId = requestAnimationFrame(frame);
    return cancelFlight;
  }, [activeItem.coord, cancelFlight, expanded, routes]);

  function expand() {
    if (performance.now() - sizeChangedAtRef.current < 800) return;
    onInteraction();
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    setExpanded(true);
  }

  function queueCollapse() {
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = window.setTimeout(() => setExpanded(false), 700);
  }

  function stepSize(direction: 1 | -1) {
    sizeChangedAtRef.current = performance.now();
    setSizeIndex((current) => {
      const next = Math.min(COLLAPSED_SIZES.length - 1, Math.max(0, current + direction));
      if (typeof window !== "undefined") window.localStorage.setItem(SIZE_STORAGE_KEY, String(next));
      return next;
    });
  }

  function rotateBy(degrees: number) {
    const map = mapRef.current;
    if (!map) return;
    onInteraction();
    cancelFlight();
    map.easeTo({ bearing: map.getBearing() + degrees, duration: 250, essential: true });
  }

  // With the expand button gone, touch users need a way back out: any tap
  // outside the mini-map collapses it (hover-leave covers pointer users).
  useEffect(() => {
    if (!expanded) return;
    const handler = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [expanded]);

  const controlButton = "pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-stone-950/55 text-white backdrop-blur transition hover:bg-stone-950/75 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40";
  const sizeControls = (
    <>
      <button type="button" onClick={() => stepSize(-1)} disabled={sizeIndex === 0} className={controlButton} aria-label="Shrink mini-map" title="Smaller mini-map">
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => stepSize(1)} disabled={sizeIndex === COLLAPSED_SIZES.length - 1} className={controlButton} aria-label="Grow mini-map" title="Larger mini-map">
        <Plus className="h-3.5 w-3.5" />
      </button>
    </>
  );

  return (
    <div ref={rootRef} className="absolute right-3 top-16 z-40 md:right-6 md:top-auto md:bottom-6" onMouseLeave={queueCollapse}>
      {/* Size controls float above the collapsed map (outside the hover-expand
          zone, so reaching for them doesn't balloon the map mid-click) and
          move inside the top-right corner once expanded. */}
      {!expanded ? <div className="absolute -top-9 right-0 flex items-center gap-1">{sizeControls}</div> : null}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-white/20 bg-stone-950/70 shadow-2xl transition-all duration-300",
          expanded ? "h-[min(62dvh,32rem)] w-[min(92vw,40rem)]" : COLLAPSED_SIZES[sizeIndex],
        )}
        onMouseEnter={expand}
      >
        {expanded ? <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">{sizeControls}</div> : null}
        <div ref={containerRef} className="h-full w-full" onPointerDown={expand} />
        {!unavailable ? (
          <div className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1">
            <button type="button" onClick={() => rotateBy(-15)} className={controlButton} aria-label="Rotate map left" title="Rotate left 15°">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => rotateBy(15)} className={controlButton} aria-label="Rotate map right" title="Rotate right 15°">
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
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
    </div>
  );
}
