import { afterEach, describe, it, expect, vi } from "vitest";
import { canDecodeImage, dimensionsFor, extensionlessName, isHeic, preparePhotoFiles } from "./photo-processing";

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
    expect(result).toEqual({ imageFile: file, thumbnailFile: null, markerFile: null, optimized: false });
  });

  it("passes through unsupported file types without attempting to re-encode", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "clip.gif", { type: "image/gif" });
    const result = await preparePhotoFiles(file);
    expect(result.imageFile).toBe(file);
    expect(result.optimized).toBe(false);
  });
});

describe("preparePhotoFiles (canvas environment)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function installCanvasMocks(options: { bitmap?: Partial<ImageBitmap>; blobSize?: (width: number) => number | null } = {}) {
    const drawImage = vi.fn();
    const close = vi.fn();
    const bitmap = {
      width: 4000,
      height: 3000,
      close,
      ...options.bitmap,
    } as ImageBitmap;

    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage })),
        toBlob(this: HTMLCanvasElement, callback: BlobCallback, type: string) {
          const size = options.blobSize?.(this.width) ?? 10;
          callback(size === null ? null : new Blob([new Uint8Array(size)], { type }));
        },
      })),
    });

    return { bitmap, close, drawImage };
  }

  it("creates a smaller JPEG image and thumbnail for large browser-supported photos", async () => {
    const { close, drawImage } = installCanvasMocks({ blobSize: (width) => (width > 520 ? 2048 : 512) });
    const file = new File([new Uint8Array(3 * 1024 * 1024)], "ridge.png", { type: "image/png", lastModified: 123 });
    const result = await preparePhotoFiles(file);

    expect(result.optimized).toBe(true);
    expect(result.imageFile).not.toBe(file);
    expect(result.imageFile.name).toBe("ridge.jpg");
    expect(result.imageFile.type).toBe("image/jpeg");
    expect(result.imageFile.lastModified).toBe(123);
    expect(result.thumbnailFile?.name).toBe("ridge-thumb.jpg");
    expect(result.thumbnailFile?.type).toBe("image/jpeg");
    expect(result.thumbnailFile?.size).toBe(512);
    expect(result.markerFile?.name).toBe("ridge-marker.jpg");
    expect(result.markerFile?.type).toBe("image/jpeg");
    expect(drawImage).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("crops the marker image to a centred 144 px square", async () => {
    const { bitmap, drawImage } = installCanvasMocks();
    const file = new File([new Uint8Array(1024)], "wide.jpg", { type: "image/jpeg" });
    await preparePhotoFiles(file);

    // 4000x3000: the 3000 px square starts 500 px in and scales to 144x144.
    expect(drawImage).toHaveBeenCalledWith(bitmap, 500, 0, 3000, 3000, 0, 0, 144, 144);
  });

  it("re-encodes a decodable HEIC to JPEG even when the JPEG is larger", async () => {
    installCanvasMocks({ bitmap: { width: 1200, height: 800 }, blobSize: (width) => (width > 520 ? 4096 : 256) });
    // Browsers often report no MIME type for HEIC, so the extension decides.
    const file = new File([new Uint8Array(1024)], "fjord.HEIC", { type: "" });
    const result = await preparePhotoFiles(file);

    expect(result.optimized).toBe(true);
    expect(result.imageFile.name).toBe("fjord.jpg");
    expect(result.imageFile.type).toBe("image/jpeg");
    expect(result.thumbnailFile?.name).toBe("fjord-thumb.jpg");
    expect(result.markerFile?.name).toBe("fjord-marker.jpg");
  });

  it("keeps the original small image while still creating a thumbnail", async () => {
    installCanvasMocks({ bitmap: { width: 1200, height: 800 }, blobSize: () => 256 });
    const file = new File([new Uint8Array(1024)], "small.jpg", { type: "image/jpeg" });
    const result = await preparePhotoFiles(file);

    expect(result.imageFile).toBe(file);
    expect(result.optimized).toBe(false);
    expect(result.thumbnailFile?.name).toBe("small-thumb.jpg");
    expect(result.thumbnailFile?.size).toBe(256);
  });

  it("does not replace the original when the optimized image is larger", async () => {
    installCanvasMocks({ blobSize: (width) => (width > 520 ? 4 * 1024 * 1024 : 512) });
    const file = new File([new Uint8Array(3 * 1024 * 1024)], "fog.webp", { type: "image/webp" });
    const result = await preparePhotoFiles(file);

    expect(result.imageFile).toBe(file);
    expect(result.optimized).toBe(false);
    expect(result.thumbnailFile?.size).toBe(512);
  });

  it("falls back to the original when browser decoding fails", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("bad pixels")));
    vi.stubGlobal("document", { createElement: vi.fn() });
    const file = new File([new Uint8Array([1, 2, 3])], "corrupt.jpg", { type: "image/jpeg" });
    const result = await preparePhotoFiles(file);

    expect(result).toEqual({ imageFile: file, thumbnailFile: null, markerFile: null, optimized: false });
    expect(close).not.toHaveBeenCalled();
  });
});

describe("HEIC selection checks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognises HEIC by MIME type or, when the type is missing, by extension", () => {
    expect(isHeic(new File([], "a.heic", { type: "image/heic" }))).toBe(true);
    expect(isHeic(new File([], "a.HEIF", { type: "" }))).toBe(true);
    expect(isHeic(new File([], "a.heic", { type: "application/octet-stream" }))).toBe(true);
    expect(isHeic(new File([], "a.jpg", { type: "image/jpeg" }))).toBe(false);
  });

  it("reports whether the browser can decode the file", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close }));
    expect(await canDecodeImage(new File([], "a.heic"))).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);

    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new DOMException("unsupported")));
    expect(await canDecodeImage(new File([], "a.heic"))).toBe(false);
  });

  it("treats a browser without createImageBitmap as unable to decode", async () => {
    expect(await canDecodeImage(new File([], "a.heic"))).toBe(false);
  });
});
