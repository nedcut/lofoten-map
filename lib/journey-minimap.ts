// Pure pieces of the Journey mini-map's lifecycle, kept out of the component
// so they can be tested without Mapbox or a DOM.

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
