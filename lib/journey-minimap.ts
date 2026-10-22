// Pure pieces of the Journey mini-map's lifecycle, kept out of the component
// so they can be tested without Mapbox or a DOM.

/** How long the mini-map's style may take to load before it counts as failed. */
export const MINIMAP_LOAD_TIMEOUT_MS = 15_000;

/**
 * Whether a Mapbox "error" event means the mini-map cannot start. Only
 * failures before the first "style.load" count, and only those not tied to a
 * source: a missing tile or a failed terrain/DEM request carries a
 * `sourceId` and the map still works without it, while a failed style
 * request (HTTP 5xx, bad token, offline) has none and leaves an empty canvas.
 */
export function isFatalMinimapError(event: object, loaded: boolean) {
  if (loaded) return false;
  // Mapbox's error event type omits the source fields it attaches at runtime.
  const { sourceId, tile } = event as { sourceId?: unknown; tile?: unknown };
  return sourceId === undefined && tile === undefined;
}

export const MINIMAP_VISIBLE_STORAGE_KEY = "lofoten-minimap-visible";

/** Below this viewport height the photo needs every pixel, so the map starts hidden. */
export const SHORT_SCREEN_MAX_HEIGHT = 700;

/**
 * Whether the mini-map starts shown. A choice made earlier in the session
 * wins; otherwise it starts hidden on short screens (phones in either
 * orientation, small laptop windows) where it would cover the photo.
 */
export function initialMinimapVisible(stored: string | null, viewportHeight: number) {
  if (stored === "1") return true;
  if (stored === "0") return false;
  return viewportHeight > SHORT_SCREEN_MAX_HEIGHT;
}
