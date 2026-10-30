"use client";

import mapboxgl from "mapbox-gl";
// Loaded here rather than in globals.css so the vendored stylesheet and our map
// overrides ship with this lazily-imported (ssr:false) map chunk, keeping them
// off the render-blocking critical path. The overrides import must follow the
// vendor sheet so its cascade wins.
import "mapbox-gl/dist/mapbox-gl.css";
import "./map-overrides.css";
import { MapPin } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { sidebarInset } from "@/components/DaySidebar";
import { mobileSheetHeight } from "@/components/MobileSheet";
import { Button } from "@/components/ui/Button";
import { lofotenOpeningView } from "@/lib/geo";
import { applyLofotenAtmosphere } from "@/lib/map-atmosphere";
import { watchMapInit } from "@/lib/map-init";
import type { LngLat, MapClickMode } from "@/types/trip";

type Props = {
  clickMode: MapClickMode;
  pendingCoordinate: LngLat | null;
  onMapReady: (map: mapboxgl.Map) => void;
  onMapUnavailable: () => void;
  onCoordinatePick: (coordinate: LngLat) => void;
  children?: ReactNode;
};

export function MapView({ clickMode, pendingCoordinate, onMapReady, onMapUnavailable, onCoordinatePick, children }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // The marker outlives any single render, so its dragend handler reads the
  // latest pick callback through a ref instead of re-binding on every change.
  const onCoordinatePickRef = useRef(onCoordinatePick);
  const [tokenMissing, setTokenMissing] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState<string | null>(null);
  // Set when the map failed for a reason that may pass (a style request that
  // errored or timed out), so the fallback offers to try again.
  const [canRetry, setCanRetry] = useState(false);
  // Bumped by Retry; the init effect depends on it to build a fresh map.
  const [attempt, setAttempt] = useState(0);
  const clickPrompt = clickMode === "draw-route" ? "Tap the map to add route points" : "Tap the map to set the location";

  useEffect(() => {
    onCoordinatePickRef.current = onCoordinatePick;
  }, [onCoordinatePick]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("map-unavailable-active");
    };
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- one-shot sync from Mapbox availability (token/WebGL/init failure, an external system) during mount; intentional. */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const markUnavailable = (message?: string) => {
      if (message) setMapUnavailable(message);
      containerRef.current?.replaceChildren();
      document.body.classList.add("map-unavailable-active");
      document
        .querySelectorAll(".mapboxgl-control-container, .mapboxgl-ctrl-bottom-left, .mapboxgl-ctrl-bottom-right")
        .forEach((element) => element.remove());
      onMapUnavailable();
    };
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setTokenMissing(true);
      markUnavailable();
      return;
    }
    if (!mapboxgl.supported()) {
      markUnavailable("Your browser or device does not support WebGL, so the interactive map cannot load here.");
      return;
    }
    mapboxgl.accessToken = token;
    let instance: mapboxgl.Map;
    // Same camera as "All days" (app/page.tsx). MapOptions takes no padding,
    // so it's set right after construction, before the first frame renders.
    const { padding, ...openingView } = lofotenOpeningView(window.innerWidth, mobileSheetHeight(), sidebarInset());
    try {
      instance = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/outdoors-v12",
        ...openingView,
        attributionControl: false,
      });
      instance.setPadding(padding);
    } catch {
      markUnavailable("The interactive map could not start in this browser. The trip details are still available.");
      return;
    }
    instance.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
    instance.addControl(new mapboxgl.AttributionControl({ compact: true }));
    let removed = false;
    const removeInstance = () => {
      if (removed) return;
      removed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      instance.remove();
      mapRef.current = null;
    };
    // Construction succeeding doesn't mean the map will load: the style is
    // fetched asynchronously, and a failed or stalled request otherwise leaves
    // an empty panel with no explanation.
    const stopWatching = watchMapInit(instance, () => {
      removeInstance();
      setCanRetry(true);
      markUnavailable("The map couldn't load. Check your connection and try again. The trip details are still available.");
    });
    // Terrain, haze and the toned basemap. style.load (not load) so they are
    // in place before the first frame the user sees, and survive style swaps.
    instance.on("style.load", () => applyLofotenAtmosphere(instance));
    instance.on("load", () => {
      document.body.classList.remove("map-unavailable-active");
      onMapReady(instance);
    });
    mapRef.current = instance;
    return () => {
      stopWatching();
      removeInstance();
      document.body.classList.remove("map-unavailable-active");
    };
  }, [onMapReady, onMapUnavailable, attempt]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (event: mapboxgl.MapMouseEvent) => onCoordinatePick({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    if (clickMode !== "idle") {
      const canvas = map.getCanvas();
      if (canvas) canvas.style.cursor = "crosshair";
      map.on("click", handler);
    }
    return () => {
      map.off("click", handler);
      const canvas = map.getCanvas();
      if (canvas) canvas.style.cursor = "";
    };
  }, [clickMode, onCoordinatePick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pendingCoordinate) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const marker = new mapboxgl.Marker({ color: "#0f766e", draggable: true }).setLngLat([pendingCoordinate.lng, pendingCoordinate.lat]).addTo(map);
      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        onCoordinatePickRef.current({ lng: lngLat.lng, lat: lngLat.lat });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([pendingCoordinate.lng, pendingCoordinate.lat]);
    }
  }, [pendingCoordinate]);

  return (
    <div className={`relative h-full min-h-[520px] overflow-hidden bg-[#dbe7df] ${tokenMissing || mapUnavailable ? "map-unavailable" : ""}`}>
      <div ref={containerRef} className="h-full w-full" />
      {tokenMissing || mapUnavailable ? (
        <div className="absolute inset-0 flex items-center justify-center bg-mist p-6 text-center">
          <div className="max-w-md rounded-[1.25rem] border border-stone-200 bg-paper/94 p-6 shadow-2xl">
            <h2 className="font-serif text-3xl font-semibold text-stone-950">{tokenMissing ? "Mapbox token needed" : "Map unavailable"}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {tokenMissing ? "Add NEXT_PUBLIC_MAPBOX_TOKEN to your environment to load the interactive trip map." : mapUnavailable}
            </p>
            {canRetry && !tokenMissing ? (
              <Button
                className="mt-4"
                onClick={() => {
                  setCanRetry(false);
                  setMapUnavailable(null);
                  setAttempt((current) => current + 1);
                }}
              >
                Retry
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {clickMode !== "idle" && !tokenMissing && !mapUnavailable ? (
        <div className="absolute left-1/2 top-16 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-teal-700/20 bg-paper/94 px-4 py-2 text-center text-sm font-bold text-teal-950 shadow-xl backdrop-blur md:top-4">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-600/60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal-700" />
          </span>
          <MapPin className="h-4 w-4" /> {clickPrompt}
        </div>
      ) : null}
      {children}
    </div>
  );
}
