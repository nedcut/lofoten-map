import { describe, it, expect } from "vitest";
import { dimensionsFor, extensionlessName, preparePhotoFiles } from "./photo-processing";

describe("dimensionsFor", () => {
  it("leaves an image smaller than the max edge untouched", () => {
    expect(dimensionsFor(2200, 1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it("scales a landscape image down to the max long edge, preserving aspect ratio", () => {
    // 4000x3000 capped at 2200 wide -> scale 0.55 -> 2200x1650
    expect(dimensionsFor(2200, 4000, 3000)).toEqual({ width: 2200, height: 1650 });
  });

  it("scales a portrait image by its taller edge", () => {
    // 3000x4000 capped at 2200 tall -> scale 0.55 -> 1650x2200
    expect(dimensionsFor(2200, 3000, 4000)).toEqual({ width: 1650, height: 2200 });
  });

  it("never collapses a dimension below 1px", () => {
    const { width, height } = dimensionsFor(520, 10000, 1);
    expect(width).toBeGreaterThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("rounds to whole pixels", () => {
    const { width, height } = dimensionsFor(520, 1999, 1333);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });
});

describe("extensionlessName", () => {
  it("strips a single trailing extension", () => {
    expect(extensionlessName("sunset.jpg")).toBe("sunset");
    expect(extensionlessName("IMG_1234.HEIC")).toBe("IMG_1234");
  });

  it("only strips the final extension on multi-dot names", () => {
    expect(extensionlessName("trip.2026.jpeg")).toBe("trip.2026");
  });

  it("falls back to 'photo' for a dotfile with no stem", () => {
    expect(extensionlessName(".jpg")).toBe("photo");
  });

  it("returns the name unchanged when there is no extension", () => {
    expect(extensionlessName("README")).toBe("README");
  });
});

describe("preparePhotoFiles (no-canvas environment)", () => {
  it("returns the original file untouched when canvas APIs are unavailable", async () => {
    // Under the node test environment there is no document/createImageBitmap,
    // so preparation must degrade gracefully to a pass-through.
    const file = new File([new Uint8Array([1, 2, 3])], "sunset.jpg", { type: "image/jpeg" });
    const result = await preparePhotoFiles(file);
    expect(result).toEqual({ imageFile: file, thumbnailFile: null, optimized: false });
  });

  it("passes through unsupported file types without attempting to re-encode", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "clip.gif", { type: "image/gif" });
    const result = await preparePhotoFiles(file);
    expect(result.imageFile).toBe(file);
    expect(result.optimized).toBe(false);
  });
});
