import { describe, expect, it } from "vitest";
import {
  PHOTO_CLUSTER_MAX_ZOOM,
  PHOTO_CLUSTER_RADIUS,
  PHOTO_MARKER_OVERVIEW_ZOOM,
  photoMarkerPresentation,
} from "./map-presentation";

describe("photo marker presentation", () => {
  it("uses the calmer overview treatment below the detail threshold", () => {
    const presentation = photoMarkerPresentation(PHOTO_MARKER_OVERVIEW_ZOOM - 0.01, 1);
    expect(presentation).toEqual({
      isCluster: false,
      isOverview: true,
      className: "lofoten-photo-marker lofoten-photo-marker-overview",
    });
  });

  it("switches to the detail treatment at the threshold", () => {
    expect(photoMarkerPresentation(PHOTO_MARKER_OVERVIEW_ZOOM, 1).isOverview).toBe(false);
  });

  it("distinguishes clusters without making their class depend on count size", () => {
    expect(photoMarkerPresentation(10, 2).className).toBe(
      "lofoten-photo-marker lofoten-photo-marker-cluster lofoten-photo-marker-overview",
    );
    expect(photoMarkerPresentation(10, 10_000).className).toBe(
      "lofoten-photo-marker lofoten-photo-marker-cluster lofoten-photo-marker-overview",
    );
  });

  it("falls back to the detail treatment for invalid zoom and a single marker for invalid count", () => {
    expect(photoMarkerPresentation(Number.NaN, Number.NaN)).toEqual({
      isCluster: false,
      isOverview: false,
      className: "lofoten-photo-marker",
    });
  });

  it("keeps the shared Mapbox cluster settings deliberate", () => {
    expect(PHOTO_CLUSTER_RADIUS).toBe(80);
    expect(PHOTO_CLUSTER_MAX_ZOOM).toBe(17);
  });
});
