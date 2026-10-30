// Where the sun was for a photo, so Journey Mode can point out what made this
// trip unusual: at Lofoten's latitude in late May and June the sun never sets,
// and a 2 AM ferry crossing happens in daylight.

const RAD = Math.PI / 180;

/**
 * The sun's geometric elevation above the horizon, in degrees, at an instant
 * and place. A compact form of the standard low-precision solar position
 * (accurate to a few hundredths of a degree this century), which is plenty
 * for "was the sun up".
 */
export function solarElevationDeg(date: Date, lat: number, lng: number): number {
  const days = date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0;
  const meanLongitude = (280.46 + 0.9856474 * days) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * days) % 360) * RAD;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * days) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const siderealDeg = ((18.697374558 + 24.06570982441908 * days) % 24) * 15;
  const hourAngle = (siderealDeg + lng) * RAD - rightAscension;
  const latRad = lat * RAD;
  const sine = Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sine))) / RAD;
}

// Local solar time (0–24 h) from longitude: noon is when the sun is highest,
// whatever the clock or time zone says.
function solarHour(date: Date, lng: number) {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return (((utcHours + lng / 15) % 24) + 24) % 24;
}

// The sun's disc clears the horizon once refraction and its radius are counted.
const APPARENT_SUNRISE_DEG = -0.833;
// Civil twilight: bright enough to read and hike without a lamp.
const CIVIL_TWILIGHT_DEG = -6;

export type NightLight = "midnight-sun" | "bright-night";

/**
 * For a moment in the small hours, what the sky was doing: the sun still up,
 * or a night that never got dark. Null in the daytime (nothing remarkable
 * about daylight at noon) and on a properly dark night.
 */
export function nightLight(takenAt: string | null | undefined, lat: number, lng: number): NightLight | null {
  if (!takenAt) return null;
  const date = new Date(takenAt);
  if (Number.isNaN(date.getTime())) return null;
  const hour = solarHour(date, lng);
  if (hour >= 3 && hour < 21.5) return null;
  const elevation = solarElevationDeg(date, lat, lng);
  if (elevation > APPARENT_SUNRISE_DEG) return "midnight-sun";
  if (elevation > CIVIL_TWILIGHT_DEG) return "bright-night";
  return null;
}

export function nightLightLabel(light: NightLight) {
  return light === "midnight-sun" ? "Midnight sun" : "Bright night";
}
