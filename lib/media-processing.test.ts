import { describe, expect, it } from "vitest";
import { detectMediaType, mediaTypeForFile, prepareMediaFiles, storageFileExtension } from "./media-processing";

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

describe("storageFileExtension", () => {
  it("derives the extension from the MIME type for rewritten media", () => {
    expect(storageFileExtension(new File([], "photo.heic", { type: "image/jpeg" }))).toBe("jpg");
    expect(storageFileExtension(new File([], "shot.png", { type: "image/png" }))).toBe("png");
    expect(storageFileExtension(new File([], "clip.mov", { type: "video/quicktime" }))).toBe("mov");
    expect(storageFileExtension(new File([], "clip.m4v", { type: "video/x-m4v" }))).toBe("mp4");
  });

  it("falls back to the lowercased filename extension, then jpg", () => {
    expect(storageFileExtension(new File([], "raw.CR2", { type: "application/octet-stream" }))).toBe("cr2");
    expect(storageFileExtension(new File([], "noextension", { type: "" }))).toBe("jpg");
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
