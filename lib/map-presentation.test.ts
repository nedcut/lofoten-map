import { describe, expect, it } from "vitest";
import {
  markerOverlapWinners,
  PHOTO_CLUSTER_MAX_ZOOM,
  PHOTO_CLUSTER_RADIUS,
  PHOTO_MARKER_OVERVIEW_ZOOM,
  clusterTapZoomsIn,
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

describe("clusterTapZoomsIn", () => {
  it("zooms in when the cluster splits at a meaningfully closer zoom", () => {
    expect(clusterTapZoomsIn(13, 11)).toBe(true);
    expect(clusterTapZoomsIn(PHOTO_CLUSTER_MAX_ZOOM, 15)).toBe(true);
  });

  it("does not zoom for photos stacked at one spot (expansion past clusterMaxZoom)", () => {
    expect(clusterTapZoomsIn(PHOTO_CLUSTER_MAX_ZOOM + 1, 10)).toBe(false);
  });

  it("does not zoom when the map is already at or nearly at the expansion zoom", () => {
    expect(clusterTapZoomsIn(14, 14)).toBe(false);
    expect(clusterTapZoomsIn(14, 14.5)).toBe(false);
    expect(clusterTapZoomsIn(14, 13.8)).toBe(false);
  });
});

describe("markerOverlapWinners", () => {
  it("keeps markers that are far enough apart", () => {
    const kept = markerOverlapWinners([
      { key: "a", x: 0, y: 0, count: 3 },
      { key: "b", x: 40, y: 0, count: 2 },
    ], 32);
    expect([...kept].sort()).toEqual(["a", "b"]);
  });

  it("keeps the bigger cluster of an overlapping pair", () => {
    const kept = markerOverlapWinners([
      { key: "small", x: 0, y: 100, count: 2 },
      { key: "big", x: 10, y: 90, count: 9 },
    ], 32);
    expect([...kept]).toEqual(["big"]);
  });

  it("breaks a count tie toward the nearer marker", () => {
    const kept = markerOverlapWinners([
      { key: "far", x: 0, y: 50, count: 4 },
      { key: "near", x: 5, y: 60, count: 4 },
    ], 32);
    expect([...kept]).toEqual(["near"]);
  });

  it("keeps a pinned marker without hiding its neighbours", () => {
    const kept = markerOverlapWinners([
      { key: "dragged", x: 0, y: 0, count: 1, pinned: true },
      { key: "cluster", x: 4, y: 4, count: 12 },
    ], 32);
    expect([...kept].sort()).toEqual(["cluster", "dragged"]);
  });
});
