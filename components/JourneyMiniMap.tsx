"use client";

import mapboxgl from "mapbox-gl";
import { Expand, MapPin } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import { LOFOTEN_CENTER, routeFeatureCollection } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { JourneyItem } from "@/lib/journey";
import type { Day, RouteSegment } from "@/types/trip";

type Props = {
  routes: RouteSegment[];
  days: Day[];
  items: JourneyItem[];
  activeItem: JourneyItem;
  onInteraction: () => void;
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

function pointData(items: JourneyItem[], activeItemId: string): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: items.flatMap((item) => item.coord ? [{
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [item.coord.lng, item.coord.lat] },
      properties: { id: item.id, kind: item.kind, active: item.id === activeItemId },
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

export function JourneyMiniMap({ routes, days, items, activeItem, onInteraction }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const routeData = useMemo(() => routeFeatureCollection(routes), [routes]);
  const progressRouteData = useMemo(() => routeFeatureCollection(progressedRoutes(routes, days, activeItem)), [activeItem, days, routes]);
  const itemsData = useMemo(() => pointData(items, activeItem.id), [activeItem.id, items]);
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
        pitch: 25,
        bearing: -12,
        attributionControl: false,
        interactive: true,
      });
    } catch {
      setUnavailable("Map unavailable");
      return;
    }
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [activeItem.coord]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const noteInteraction = () => onInteraction();
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
  }, [onInteraction]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    window.setTimeout(() => map.resize(), 40);
    if (activeItem.coord) {
      map.easeTo({ center: [activeItem.coord.lng, activeItem.coord.lat], zoom: expanded ? 13.2 : 12.2, duration: 900, essential: true });
    }
  }, [activeItem.coord, expanded]);

  function expand() {
    onInteraction();
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    setExpanded(true);
  }

  function queueCollapse() {
    if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = window.setTimeout(() => setExpanded(false), 1200);
  }

  return (
    <div
      className={cn(
        "absolute bottom-[13.25rem] right-3 z-20 overflow-hidden rounded-xl border border-white/20 bg-stone-950/70 shadow-2xl transition-all duration-300 md:bottom-6 md:right-6",
        expanded ? "h-[min(54dvh,26rem)] w-[min(88vw,30rem)]" : "h-28 w-36 sm:h-36 sm:w-48",
      )}
      onMouseEnter={expand}
      onMouseLeave={queueCollapse}
    >
      <button type="button" onClick={() => (expanded ? setExpanded(false) : expand())} className="absolute right-2 top-2 z-10 rounded-lg bg-[rgba(255,253,246,0.94)] p-2 text-stone-800 shadow-lg transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40" aria-label={expanded ? "Collapse map" : "Expand map"}>
        <Expand className="h-4 w-4" />
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
