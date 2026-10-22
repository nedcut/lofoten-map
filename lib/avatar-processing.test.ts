import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSquareCrop, prepareAvatarFile } from "./avatar-processing";

describe("computeSquareCrop", () => {
  it("takes the largest centered square, so the avatar is cropped rather than stretched", () => {
    expect(computeSquareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, size: 3000 });
    expect(computeSquareCrop(3000, 4000)).toEqual({ sx: 0, sy: 500, size: 3000 });
    expect(computeSquareCrop(512, 512)).toEqual({ sx: 0, sy: 0, size: 512 });
  });
});

describe("prepareAvatarFile", () => {
  afterEach(() => vi.unstubAllGlobals());

  function installCanvas(encoded: Blob | null) {
    const drawImage = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }));
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage })),
        toBlob: (callback: BlobCallback) => callback(encoded),
      })),
    });
    return { drawImage };
  }

  it("draws the center crop into a square JPEG", async () => {
    const { drawImage } = installCanvas(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    const result = await prepareAvatarFile(new File([new Uint8Array(3)], "me.png", { type: "image/png" }));
    expect(result.type).toBe("image/jpeg");
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 500, 0, 3000, 3000, 0, 0, 384, 384);
  });

  it("converts HEIC, including when the browser reports no type", async () => {
    installCanvas(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    for (const file of [new File([], "me.heic", { type: "image/heic" }), new File([], "IMG_1.HEIC", { type: "" })]) {
      expect((await prepareAvatarFile(file)).type).toBe("image/jpeg");
    }
  });

  it("fails instead of passing raw HEIC through when encoding fails", async () => {
    installCanvas(null);
    for (const file of [
      new File([], "me.heic", { type: "image/heic" }),
      new File([], "me.heif", { type: "application/octet-stream" }),
      new File([], "IMG_1.HEIC", { type: "" }),
    ]) {
      await expect(prepareAvatarFile(file)).rejects.toThrow("Could not convert HEIC/HEIF to JPEG");
    }
  });

  it("fails for HEIC when the browser cannot decode it", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new DOMException("unsupported")));
    vi.stubGlobal("document", { createElement: vi.fn() });
    await expect(prepareAvatarFile(new File([], "me.heic", { type: "image/heic" }))).rejects.toThrow("Could not convert HEIC/HEIF to JPEG");
  });

  it("keeps the original for other formats when encoding fails", async () => {
    installCanvas(null);
    const file = new File([new Uint8Array(3)], "me.png", { type: "image/png" });
    expect(await prepareAvatarFile(file)).toBe(file);
  });
});
