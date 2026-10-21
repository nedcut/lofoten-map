import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, maxUploadBytesFor, mediaTypeForContentType, storedContentType } from "./media-formats";

describe("storedContentType", () => {
  it("uses the reported MIME type, canonicalising aliases", () => {
    expect(storedContentType(new File([], "a.jpg", { type: "image/jpeg" }))).toBe("image/jpeg");
    expect(storedContentType(new File([], "a.jpg", { type: "image/jpg" }))).toBe("image/jpeg");
    expect(storedContentType(new File([], "a.m4v", { type: "video/x-m4v" }))).toBe("video/mp4");
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(storedContentType(new File([], "IMG_1.HEIC", { type: "" }))).toBe("image/heic");
    expect(storedContentType(new File([], "IMG_1.heif", { type: "application/octet-stream" }))).toBe("image/heif");
    expect(storedContentType(new File([], "clip.MOV", { type: "" }))).toBe("video/quicktime");
  });

  it("returns null for formats the app does not store", () => {
    expect(storedContentType(new File([], "loop.gif", { type: "image/gif" }))).toBeNull();
    expect(storedContentType(new File([], "clip.webm", { type: "video/webm" }))).toBeNull();
    expect(storedContentType(new File([], "clip.webm", { type: "" }))).toBeNull();
    // A specific wrong type is not second-guessed from the name.
    expect(storedContentType(new File([], "fake.jpg", { type: "text/html" }))).toBeNull();
  });
});

describe("upload limits", () => {
  it("caps photos and videos separately, and refuses unknown types", () => {
    expect(mediaTypeForContentType("image/heic")).toBe("photo");
    expect(mediaTypeForContentType("video/quicktime")).toBe("video");
    expect(maxUploadBytesFor("image/jpeg")).toBe(MAX_UPLOAD_BYTES.photo);
    expect(maxUploadBytesFor("VIDEO/MP4")).toBe(MAX_UPLOAD_BYTES.video);
    expect(maxUploadBytesFor("text/html")).toBeNull();
  });
});
