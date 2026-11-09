// The first moment: on a plain first visit the map opens high over the
// Norwegian Sea, looking straight down, and descends onto the islands as it
// tilts into the terrain. Once per browser session, only on a bare landing
// (a shared day, photo, or Journey link should go straight to its content),
// and never for reduced-motion users.

import { isStorageAvailable, readStorage, writeStorage } from "@/lib/safe-storage";

export const OPENING_FLIGHT_START = { center: [13.4, 67.55] as [number, number], zoom: 5.8, pitch: 0, bearing: 0 };
export const OPENING_FLIGHT_MS = 4600;
const PLAYED_KEY = "lofoten-opening-flight";

export function shouldPlayOpeningFlight() {
  if (typeof window === "undefined" || window.location.search) return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  // Without storage we can't remember the flight played, so skip it rather
  // than replaying it on every load.
  if (!isStorageAvailable("session")) return false;
  return readStorage("session", PLAYED_KEY) !== "1";
}

export function markOpeningFlightPlayed() {
  writeStorage("session", PLAYED_KEY, "1");
}
