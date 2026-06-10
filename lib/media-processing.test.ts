import { describe, expect, it } from "vitest";
import { detectMediaType, mediaTypeForFile, prepareMediaFiles } from "./media-processing";

describe("detectMediaType", () => {
  it("distinguishes photos and videos", () => {
    expect(detectMediaType(new File([], "still.jpg", { type: "image/jpeg" }))).toBe("photo");
    expect(detectMediaType(new File([], "still.heic", { type: "" }))).toBe("photo");
    expect(detectMediaType(new File([], "clip.mov", { type: "video/quicktime" }))).toBe("video");
    expect(detectMediaType(new File([], "clip.MOV"))).toBe("video");
    expect(detectMediaType(new File([], "notes.txt", { type: "text/plain" }))).toBeNull();
  });
});

describe("mediaTypeForFile", () => {
  it("defaults unknown files to photo", () => {
    expect(mediaTypeForFile(new File([], "notes.txt", { type: "text/plain" }))).toBe("photo");
  });
});

describe("prepareMediaFiles", () => {
  it("passes videos through when browser video APIs are unavailable", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", { type: "video/mp4" });
    await expect(prepareMediaFiles(file)).resolves.toEqual({
      imageFile: file,
      thumbnailFile: null,
      optimized: false,
      mediaType: "video",
    });
  });
});
