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
