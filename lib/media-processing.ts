import { extensionlessName, preparePhotoFiles, type PreparedPhotoFiles } from "./photo-processing";

export type MediaType = "photo" | "video";
export type PreparedMediaFiles = PreparedPhotoFiles & { mediaType: MediaType };

const IMAGE_EXTENSIONS = [".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".gif"];
const VIDEO_EXTENSIONS = [".mov", ".mp4", ".m4v", ".webm"];

export function detectMediaType(file: File): MediaType | null {
  const lowerName = file.name.toLowerCase();
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) return "photo";
  if (file.type.startsWith("video/") || VIDEO_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) return "video";
  return null;
}

export function mediaTypeForFile(file: File): MediaType {
  return detectMediaType(file) ?? "photo";
}

function videoThumbnail(file: File): Promise<File | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (thumbnail: File | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(thumbnail);
    };
    const timer = window.setTimeout(() => finish(null), 15000);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(null);
    }, { once: true });
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(Math.max(video.duration * 0.1, 0.1), Math.max(video.duration - 0.1, 0.1));
    }, { once: true });
    video.addEventListener("seeked", () => {
      window.clearTimeout(timer);
      const scale = Math.min(1, 520 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return finish(null);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        finish(blob ? new File([blob], `${extensionlessName(file.name)}-thumb.jpg`, {
          type: "image/jpeg",
          lastModified: file.lastModified,
        }) : null);
      }, "image/jpeg", 0.76);
    }, { once: true });
    video.src = url;
  });
}

export async function prepareMediaFiles(file: File): Promise<PreparedMediaFiles> {
  const mediaType = mediaTypeForFile(file);
  if (mediaType === "photo") return { ...(await preparePhotoFiles(file)), mediaType };
  return { imageFile: file, thumbnailFile: await videoThumbnail(file), optimized: false, mediaType };
}
