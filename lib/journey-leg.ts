import type { Feature, LineString, Position } from "geojson";
import along from "@turf/along";
import bearing from "@turf/bearing";
import destination from "@turf/destination";
import distance from "@turf/distance";
import length from "@turf/length";
import lineSlice from "@turf/line-slice";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import { point } from "@turf/helpers";
import type { LngLat, RouteSegment } from "@/types/trip";

// The travel path between two consecutive journey items, used by the mini-map
// to fly the camera as if hiking from one photo to the next.
export type JourneyLeg = {
  line: Feature<LineString>;
  lengthKm: number;
  // True when the leg follows a recorded route; false for the straight-line
  // fallback between items no route connects (e.g. a ferry hop).
  onRoute: boolean;
};

// How close (km) both endpoints must snap to the same route before we trust it
// as the path actually walked. Photos are usually taken within a few dozen
// meters of the track; 250m absorbs GPS drift without grabbing the wrong trail.
const SNAP_THRESHOLD_KM = 0.25;
// Below this separation there is no meaningful travel to animate.
const MIN_LEG_KM = 0.02;

function routeLine(route: RouteSegment): Feature<LineString> {
  const geometry = (route.geometry_geojson.type === "Feature" ? route.geometry_geojson.geometry : route.geometry_geojson) as LineString;
  return { type: "Feature", geometry, properties: {} };
}

function lineOf(coordinates: Position[]): Feature<LineString> {
  return { type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} };
}

// Build the path from `prev` to `next`. Every route is scored by how closely
// both endpoints snap to it, and the best match within the threshold wins; the
// slice of that route between the snap points becomes the path (reversed when
// the items sit against the route's drawn direction). With no qualifying route
// the leg is a straight line, so the camera still travels with direction.
export function legBetween(prev: LngLat | null, next: LngLat | null, routes: RouteSegment[]): JourneyLeg | null {
  if (!prev || !next) return null;
  const start = point([prev.lng, prev.lat]);
  const end = point([next.lng, next.lat]);
  if (distance(start, end, { units: "kilometers" }) < MIN_LEG_KM) return null;

  let best: { coordinates: Position[]; score: number } | null = null;
  for (const route of routes) {
    const line = routeLine(route);
    if (line.geometry.coordinates.length < 2) continue;
    const snapStart = nearestPointOnLine(line, start, { units: "kilometers" });
    const snapEnd = nearestPointOnLine(line, end, { units: "kilometers" });
    const startDist = snapStart.properties.dist ?? Number.POSITIVE_INFINITY;
    const endDist = snapEnd.properties.dist ?? Number.POSITIVE_INFINITY;
    if (startDist > SNAP_THRESHOLD_KM || endDist > SNAP_THRESHOLD_KM) continue;
    const score = startDist + endDist;
    if (best && score >= best.score) continue;
    const slice = lineSlice(snapStart, snapEnd, line);
    const coordinates = [...slice.geometry.coordinates];
    // lineSlice returns coordinates in the route's drawn order, not travel
    // order — flip when the previous item lies further along the route.
    if ((snapStart.properties.location ?? 0) > (snapEnd.properties.location ?? 0)) coordinates.reverse();
    best = { coordinates, score };
  }

  const coordinates: Position[] = best
    ? [[prev.lng, prev.lat], ...best.coordinates, [next.lng, next.lat]]
    : [[prev.lng, prev.lat], [next.lng, next.lat]];
  const line = lineOf(coordinates);
  return { line, lengthKm: length(line, { units: "kilometers" }), onRoute: Boolean(best) };
}

// Camera position at `fraction` (0..1) of the way along the leg.
export function pointAlongLeg(leg: JourneyLeg, fraction: number): Position {
  const clamped = Math.min(1, Math.max(0, fraction));
  return along(leg.line, leg.lengthKm * clamped, { units: "kilometers" }).geometry.coordinates;
}

// Heading of travel at `fraction`, looking slightly ahead so the camera faces
// where it is going rather than oscillating with each tiny vertex.
export function bearingAlongLeg(leg: JourneyLeg, fraction: number, lookAheadKm = 0.08): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  const here = leg.lengthKm * clamped;
  const ahead = Math.min(leg.lengthKm, here + lookAheadKm);
  // At the very end of the leg, look back instead so the bearing stays defined.
  const behind = Math.max(0, here - lookAheadKm);
  const from = along(leg.line, ahead > here ? here : behind, { units: "kilometers" });
  const to = along(leg.line, ahead > here ? ahead : here, { units: "kilometers" });
  return bearing(from, to);
}

// Interpolate between compass bearings along the shortest arc, so a turn from
// 350° to 10° rotates 20° rather than 340°.
export function lerpBearing(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta * t;
}

// The point `km` away from `origin` along a compass bearing — where a
// follow-camera at `origin` should look to face the direction of travel.
export function offsetPoint(origin: Position, km: number, bearingDeg: number): Position {
  return destination(point(origin), km, bearingDeg, { units: "kilometers" }).geometry.coordinates;
}
