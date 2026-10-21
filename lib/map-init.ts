// How long a new map may take to load its style before the start is treated
// as failed. Only the style is bounded: once it has loaded, slow tiles on a
// weak connection still end in a usable map, so they are left to finish.
export const MAP_STYLE_TIMEOUT_MS = 15_000;

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
 * Calls onFatal once if the map's style fails to load: an "error" event
 * before "style.load" (for example the style request returned 503) or no
 * "style.load" within timeoutMs. Errors after the style has loaded, such as
 * an isolated tile failure, are not fatal and are ignored. Returns a disposer
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
  function fail() {
    if (done) return;
    finish();
    onFatal();
  }
  const timer = setTimeout(fail, timeoutMs);
  map.on("style.load", finish);
  map.on("error", fail);
  return finish;
}
