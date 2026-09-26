import type { Map as MapboxMap } from "mapbox-gl";

// Maps whose style has finished loading and that have not been removed.
const readyMaps = new WeakSet<MapboxMap>();

/**
 * Whether sources and layers can be read or added on this map. The probe,
 * map.getStyle(), serializes the entire basemap style, so it runs only until
 * it first succeeds; hot paths such as per-frame marker refreshes then hit the
 * cached answer. Mapbox fires "remove" after tearing the style down.
 */
export function canUseStyle(map: MapboxMap) {
  if (readyMaps.has(map)) return true;
  try {
    if (!map.getStyle()) return false;
  } catch {
    return false;
  }
  readyMaps.add(map);
  map.once("remove", () => readyMaps.delete(map));
  return true;
}
