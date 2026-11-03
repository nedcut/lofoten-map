export const PHOTO_CLUSTER_RADIUS = 80;
export const PHOTO_CLUSTER_MAX_ZOOM = 17;
export const PHOTO_MARKER_OVERVIEW_ZOOM = 12;

// Photos at (nearly) the same spot never split: Mapbox reports an expansion
// zoom past clusterMaxZoom. A tap on such a cluster, or on one that would only
// nudge the zoom, should open the photos instead of doing nothing.
const MIN_CLUSTER_ZOOM_STEP = 0.5;
export function clusterTapZoomsIn(expansionZoom: number, currentZoom: number) {
  return expansionZoom <= PHOTO_CLUSTER_MAX_ZOOM && expansionZoom >= currentZoom + MIN_CLUSTER_ZOOM_STEP;
}

export type PhotoMarkerPresentation = {
  isCluster: boolean;
  isOverview: boolean;
  className: string;
};

// Keep the zoom-dependent marker decision outside the Mapbox effect so the
// overview/detail boundary remains explicit and independently testable.
export function photoMarkerPresentation(zoom: number, count: number): PhotoMarkerPresentation {
  const isCluster = Number.isFinite(count) && count > 1;
  const isOverview = Number.isFinite(zoom) && zoom < PHOTO_MARKER_OVERVIEW_ZOOM;
  return {
    isCluster,
    isOverview,
    className: [
      "lofoten-photo-marker",
      isCluster ? "lofoten-photo-marker-cluster" : null,
      isOverview ? "lofoten-photo-marker-overview" : null,
    ].filter(Boolean).join(" "),
  };
}

// Closer than this on screen, two photo markers (52px prints) stop reading as
// a deliberate fan and become a heap of overlapping cards and count tags.
export const MARKER_OVERLAP_PX = 32;

export type MarkerOverlapCandidate = { key: string; x: number; y: number; count: number; pinned?: boolean };

// Which markers to show when some would sit nearly on top of each other.
// Bigger clusters win, then the nearer one (lower on screen, so in front on a
// tilted map); the rest fade until a zoom separates them. Pinned markers (one
// being dragged) sit outside the contest: always shown, hiding nothing, so a
// drag never makes the map around it blink. Greedy, which is plenty for the
// few dozen markers on screen at once.
export function markerOverlapWinners(candidates: MarkerOverlapCandidate[], minDistancePx: number): Set<string> {
  const ordered = candidates.filter((candidate) => !candidate.pinned).sort((a, b) => b.count - a.count || b.y - a.y);
  const kept: MarkerOverlapCandidate[] = [];
  const minSquared = minDistancePx * minDistancePx;
  for (const candidate of ordered) {
    if (!kept.some((other) => (other.x - candidate.x) ** 2 + (other.y - candidate.y) ** 2 < minSquared)) kept.push(candidate);
  }
  return new Set([...candidates.filter((candidate) => candidate.pinned), ...kept].map((candidate) => candidate.key));
}
