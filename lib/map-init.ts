// How long a new map (the main map or the Journey mini-map) may take to load
// its style before the start is treated as failed. Only the style is bounded:
// once it has loaded, slow tiles on a weak connection still end in a usable
// map, so they are left to finish.
export const MAP_STYLE_TIMEOUT_MS = 15_000;

/**
 * Whether a Mapbox "error" event means the map cannot start. Only failures
 * before the first "style.load" count, and only those not tied to a source: a
 * missing tile or a failed terrain/DEM request carries a `sourceId` and the
 * map still works without it, while a failed style request (HTTP 5xx, bad
 * token, offline) has none and leaves an empty canvas.
 */
export function isFatalMapError(event: object, styleLoaded: boolean) {
  if (styleLoaded) return false;
  // Mapbox's error event type omits the source fields it attaches at runtime.
  const { sourceId, tile } = event as { sourceId?: unknown; tile?: unknown };
  return sourceId === undefined && tile === undefined;
}

type ErrorListener = (event: { error?: unknown }) => void;

// The slice of mapboxgl.Map this watcher needs, so tests can drive it with a
// plain emitter.
export type MapInitEmitter = {
  on(type: "style.load", listener: () => void): unknown;
  on(type: "error", listener: ErrorListener): unknown;
  off(type: "style.load", listener: () => void): unknown;
  off(type: "error", listener: ErrorListener): unknown;
};

/**
 * Calls onFatal once if the map's style fails to load: a fatal "error" event
 * (see isFatalMapError; for example the style request returned 503) or no
 * "style.load" within timeoutMs. Source and tile errors, and anything after
 * the style has loaded, are not fatal and are ignored. Returns a disposer
 * that detaches the listeners and timer.
 */
export function watchMapInit(map: MapInitEmitter, onFatal: () => void, timeoutMs = MAP_STYLE_TIMEOUT_MS) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    map.off("style.load", finish);
    map.off("error", fail);
  };
  const giveUp = () => {
    if (done) return;
    finish();
    onFatal();
  };
  function fail(event: object) {
    if (isFatalMapError(event, false)) giveUp();
  }
  const timer = setTimeout(giveUp, timeoutMs);
  map.on("style.load", finish);
  map.on("error", fail);
  return finish;
}
