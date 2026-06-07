"use client";

import mapboxgl from "mapbox-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LOFOTEN_CENTER } from "@/lib/geo";
import type { LngLat, MapClickMode } from "@/types/trip";

type Props = {
  clickMode: MapClickMode;
  pendingCoordinate: LngLat | null;
  onMapReady: (map: mapboxgl.Map) => void;
  onCoordinatePick: (coordinate: LngLat) => void;
  children?: ReactNode;
};

export function MapView({ clickMode, pendingCoordinate, onMapReady, onCoordinatePick, children }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [tokenMissing, setTokenMissing] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setTokenMissing(true);
      return;
    }
    mapboxgl.accessToken = token;
    const instance = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: LOFOTEN_CENTER,
      zoom: 10.2,
      pitch: 45,
      bearing: -20,
      attributionControl: false,
    });
    instance.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
    instance.addControl(new mapboxgl.AttributionControl({ compact: true }));
    instance.on("load", () => {
      onMapReady(instance);
    });
    mapRef.current = instance;
    return () => {
      markerRef.current?.remove();
      instance.remove();
      mapRef.current = null;
    };
  }, [onMapReady]);

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
      markerRef.current = new mapboxgl.Marker({ color: "#22d3ee" }).setLngLat([pendingCoordinate.lng, pendingCoordinate.lat]).addTo(map);
    } else {
      markerRef.current.setLngLat([pendingCoordinate.lng, pendingCoordinate.lat]);
    }
  }, [pendingCoordinate]);

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-none bg-slate-900 md:rounded-[2rem]">
      <div ref={containerRef} className="h-full w-full" />
      {tokenMissing ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 p-6 text-center">
          <div className="max-w-md rounded-3xl border border-white/15 bg-white/10 p-6 shadow-2xl">
            <h2 className="text-2xl font-black text-white">Mapbox token needed</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">Add NEXT_PUBLIC_MAPBOX_TOKEN to your environment to load the interactive Lofoten map.</p>
          </div>
        </div>
      ) : null}
      {clickMode !== "idle" ? <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-slate-950/85 px-4 py-2 text-sm font-bold text-cyan-100 shadow-xl backdrop-blur">Tap the map to set location</div> : null}
      {children}
    </div>
  );
}
