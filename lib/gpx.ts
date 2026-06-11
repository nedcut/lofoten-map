import type { LineString } from "geojson";
import simplify from "@turf/simplify";

export type GpxTrackPoint = {
  lng: number;
  lat: number;
  ele: number | null;
  /** ISO-8601 timestamp from the <time> element, or null if absent. */
  time: string | null;
};

export type GpxWaypoint = {
  lng: number;
  lat: number;
  name: string;
  desc: string | null;
};

export type ParsedGpx = {
  name: string | null;
  /** All <trkpt> across every <trkseg>, flattened in document order. */
  trackPoints: GpxTrackPoint[];
  waypoints: GpxWaypoint[];
};

const TRIP_TIME_ZONE = "Europe/Oslo";
const UNDATED_BUCKET = "__undated__";

const tripDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TRIP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function gpxTimeToTripDate(time: string | null): string | null {
  if (!time) return null;
  const parsed = new Date(time);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = tripDayFormatter.formatToParts(parsed);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

// First point in the bucket that carries a usable timestamp decides the
// trip date; exporters that drop <time> on some points are skipped over.
export function firstBucketDate(points: { time: string | null }[]): string | null {
  for (const point of points) {
    const date = gpxTimeToTripDate(point.time);
    if (date) return date;
  }
  return null;
}

/**
 * Parse a GPX 1.1 document into the slice of data this app cares about:
 * the track (merged across segments), and named waypoints.
 *
 * Uses the browser-native DOMParser — only ever called client-side, so there
 * is no XML dependency to pull in. Not unit-tested under the node test env;
 * the pure helpers below are where the testable logic lives.
 */
export function parseGpx(xml: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("This file isn't valid GPX/XML.");
  }

  const textOf = (parent: Element, selector: string): string | null => {
    const node = parent.querySelector(selector);
    const value = node?.textContent?.trim();
    return value ? value : null;
  };

  const trackPoints: GpxTrackPoint[] = Array.from(doc.querySelectorAll("trk trkseg trkpt"))
    .map((pt) => {
      const ele = textOf(pt, "ele");
      return {
        lat: Number(pt.getAttribute("lat")),
        lng: Number(pt.getAttribute("lon")),
        ele: ele === null ? null : Number(ele),
        time: textOf(pt, "time"),
      };
    })
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  const waypoints: GpxWaypoint[] = Array.from(doc.querySelectorAll("gpx > wpt"))
    .map((wpt) => ({
      lat: Number(wpt.getAttribute("lat")),
      lng: Number(wpt.getAttribute("lon")),
      name: textOf(wpt, "name") ?? "Waypoint",
      desc: textOf(wpt, "desc"),
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

  return {
    name: textOf(doc.documentElement, "metadata > name") ?? textOf(doc.documentElement, "trk > name"),
    trackPoints,
    waypoints,
  };
}

/**
 * Split a flat list of trackpoints into one bucket per day, in order.
 *
 * WHY THIS MATTERS — and why it's yours to decide:
 * The trip model in this app is day-based (a Day row per calendar day, with
 * routes/notes hung off it). To import a multi-day track we have to decide
 * where one day ends and the next begins. That's a judgment call:
 *
 *   - GPX <time> values are UTC (the trailing "Z"). A hike near midnight local
 *     time in Lofoten (UTC+2 in summer) would cross a *UTC* day boundary hours
 *     before the hiker would call it a new day. Do you bucket by UTC date, or
 *     shift to a local offset first?
 *   - Points may have no <time> at all (some exporters drop it). What day do
 *     those belong to — the previous bucket, or a single fallback bucket?
 *   - Should an empty stretch (a long gap between points) start a new day, or
 *     only a calendar rollover?
 *
 * For THIS file every point is on 2026-05-28, so any reasonable choice yields a
 * single bucket — but the function is the seam that makes multi-day imports work.
 *
 * Return the buckets in chronological order; each inner array keeps the points'
 * original order. Preserve every point — this grouping must not drop data.
 *
 * TODO(you): implement the bucketing. ~5-10 lines.
 */
export function groupPointsByDay(points: GpxTrackPoint[]): GpxTrackPoint[][] {
  const buckets = new Map<string, GpxTrackPoint[]>();
  let lastKey = UNDATED_BUCKET;

  for (const point of points) {
    const key = gpxTimeToTripDate(point.time) ?? lastKey;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(point);
    lastKey = key;
  }

  return Array.from(buckets.values());
}

/**
 * Build a lightweight LineString for one day's worth of points.
 *
 * Douglas-Peucker simplification (via Turf) drops near-collinear points so a
 * 10k-point GPS trace becomes a few hundred — keeping the visible shape while
 * shrinking the DB row, the realtime payload, and the Mapbox render cost.
 * tolerance is in degrees; ~0.0001 ≈ 11m at this latitude, a sensible default
 * for a backpacking trace. Bump it up for coarser/smaller geometry.
 */
export function simplifyToLineString(points: GpxTrackPoint[], tolerance = 0.0001): LineString {
  const line: LineString = {
    type: "LineString",
    coordinates: points.map((p) => [p.lng, p.lat]),
  };
  if (line.coordinates.length < 3) return line;
  return simplify(line, { tolerance, highQuality: false });
}
