"use client";

import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import mapboxgl from "mapbox-gl";
import { useEffect, useMemo } from "react";
import type { LngLat } from "@/types/trip";

type Props = {
  map: mapboxgl.Map | null;
  points: LngLat[];
};

const sourceId = "route-draft";
const lineLayerId = "route-draft-line";
const pointLayerId = "route-draft-points";

function canUseStyle(map: mapboxgl.Map) {
  try {
    return Boolean(map.getStyle());
  } catch {
    return false;
  }
}

function getLayer(map: mapboxgl.Map, layerId: string) {
  if (!canUseStyle(map)) return undefined;
  try {
    return map.getLayer(layerId);
  } catch {
    return undefined;
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

function draftFeatureCollection(points: LngLat[]): FeatureCollection<LineString | Point> {
  const pointFeatures: Feature<Point>[] = points.map((point, index) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    properties: { index: index + 1 },
  }));

  const lineFeatures: Feature<LineString>[] = points.length >= 2
    ? [{
      type: "Feature",
      geometry: { type: "LineString", coordinates: points.map((point) => [point.lng, point.lat]) },
      properties: {},
    }]
    : [];

  return {
    type: "FeatureCollection",
    features: [...lineFeatures, ...pointFeatures],
  };
}

export function RouteDraftLayer({ map, points }: Props) {
  const draftData = useMemo(() => draftFeatureCollection(points), [points]);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const addOrUpdate = () => {
      if (cancelled || !canUseStyle(map)) return;
      if (!getSource(map, sourceId)) {
        map.addSource(sourceId, { type: "geojson", data: draftData });
        map.addLayer({
          id: lineLayerId,
          type: "line",
          source: sourceId,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: {
            "line-color": "#e7a13d",
            "line-width": 5,
            "line-opacity": 0.95,
            "line-dasharray": [1.4, 0.8],
          },
        });
        map.addLayer({
          id: pointLayerId,
          type: "circle",
          source: sourceId,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 6,
            "circle-color": "#fffdf6",
            "circle-stroke-color": "#0f766e",
            "circle-stroke-width": 3,
          },
        });
      } else {
        (getSource(map, sourceId) as mapboxgl.GeoJSONSource).setData(draftData);
      }
    };

    if (map.isStyleLoaded()) addOrUpdate();
    else map.once("load", addOrUpdate);

    return () => {
      cancelled = true;
      map.off("load", addOrUpdate);
    };
  }, [draftData, map]);

  useEffect(() => {
    return () => {
      if (!map) return;
      if (!canUseStyle(map)) return;
      if (getLayer(map, pointLayerId)) map.removeLayer(pointLayerId);
      if (getLayer(map, lineLayerId)) map.removeLayer(lineLayerId);
      if (getSource(map, sourceId)) map.removeSource(sourceId);
    };
  }, [map]);

  return null;
}
