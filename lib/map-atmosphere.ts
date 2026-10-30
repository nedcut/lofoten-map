import type { Map as MapboxMap } from "mapbox-gl";

// The Lofoten look shared by the main map and the Journey map: real 3D
// terrain (the islands are granite walls rising straight out of the sea, and
// a flat map hides that), warm haze toward the horizon, and the stock
// outdoors basemap's saturated cyan water and grey-green land pulled toward
// the app's own cream, slate and fjord palette.

export const TERRAIN_SOURCE_ID = "mapbox-dem";

// Basemap paint overrides, applied only to layers the style actually has, so
// a Mapbox style revision that renames a layer degrades to the stock colour
// instead of throwing.
const WATER = "hsl(201, 33%, 60%)";
const WATER_SHADOW = "hsl(203, 34%, 50%)";
const LAND = "hsl(44, 30%, 89%)";
const BASEMAP_PAINT: Array<[layer: string, property: string, value: unknown]> = [
  ["land", "background-color", LAND],
  ["land-structure-polygon", "fill-color", LAND],
  ["land-structure-line", "line-color", LAND],
  ["water", "fill-color", WATER],
  ["water-shadow", "fill-color", WATER_SHADOW],
  ["waterway", "line-color", WATER],
  ["waterway-shadow", "line-color", WATER_SHADOW],
  // Open sea darkens with depth instead of the stock bright-cyan wash, which
  // dominates the view from far out.
  ["water-depth", "fill-color", ["interpolate", ["linear"], ["get", "min_depth"], 0, "hsla(201, 33%, 60%, 0)", 200, "hsla(203, 36%, 44%, 0.35)", 7000, "hsla(206, 40%, 30%, 0.55)"]],
  ["water-point-label", "text-color", "hsl(200, 40%, 94%)"],
  ["water-line-label", "text-color", "hsl(200, 40%, 94%)"],
  ["water-point-label", "text-halo-color", "hsla(203, 34%, 40%, 0.35)"],
  ["water-line-label", "text-halo-color", "hsla(203, 34%, 40%, 0.35)"],
];

// Low northern light: a warm haze near the ground fading to a pale sky. The
// range starts the haze a little way out so nearby photos stay crisp.
const FOG = {
  range: [0.8, 9] as [number, number],
  color: "hsl(38, 48%, 90%)",
  "high-color": "hsl(206, 46%, 74%)",
  "space-color": "hsl(208, 38%, 86%)",
  "horizon-blend": 0.08,
  "star-intensity": 0,
};

/** Recolours the basemap, adds fog, and turns on DEM terrain. Idempotent. */
export function applyLofotenAtmosphere(map: MapboxMap, { exaggeration = 1.3 }: { exaggeration?: number } = {}) {
  for (const [layer, property, value] of BASEMAP_PAINT) {
    if (!map.getLayer(layer)) continue;
    try {
      map.setPaintProperty(layer, property as never, value as never);
    } catch {
      // A property the layer type doesn't support; leave the stock paint.
    }
  }
  map.setFog(FOG);
  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    map.addSource(TERRAIN_SOURCE_ID, { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
  }
  map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
}
