import { storedContentType } from "./media-formats";

const MAX_IMAGE_EDGE = 2200;
const MAX_THUMB_EDGE = 520;
// Map markers draw at 44-52 CSS px (map-overrides.css); a 144 px square stays
// sharp on 2x screens and close to it on 3x. JPEG, not WebP: Safari's
// canvas.toBlob cannot encode WebP and would silently return a PNG.
export const MARKER_EDGE = 144;
export const MARKER_QUALITY = 0.76;
const OPTIMIZE_ABOVE_BYTES = 2.5 * 1024 * 1024;
const OUTPUT_TYPE = "image/jpeg";
const IMAGE_QUALITY = 0.84;
const THUMB_QUALITY = 0.76;
const CANVAS_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
// Only Safari decodes HEIC, so a stored HEIC original would be a broken image
// for everyone else. When the browser can decode one, it is always re-encoded.
const HEIC_TYPES = new Set(["image/heic", "image/heif"]);

export type PreparedPhotoFiles = {
  imageFile: File;
  thumbnailFile: File | null;
  // Small square crop for the map marker, stored beside the thumbnail.
  markerFile: File | null;
  optimized: boolean;
};

export function extensionlessName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "") || "photo";
}

export function dimensionsFor(maxEdge: number, width: number, height: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isHeic(file: File) {
  return HEIC_TYPES.has(storedContentType(file) ?? "");
}

/**
 * HEIC is accepted only where the browser can decode it (Safari), because
 * that is the only way to produce a JPEG every viewer can display. Checked at
 * selection so the file is rejected with a reason instead of uploading raw.
 */
export async function canDecodeImage(file: File): Promise<boolean> {
  if (typeof createImageBitmap === "undefined") return false;
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function renderImageFile(bitmap: ImageBitmap, sourceFile: File, maxEdge: number, quality: number, suffix: string) {
  const { width, height } = dimensionsFor(maxEdge, bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, OUTPUT_TYPE, quality);
  if (!blob) return null;
  return new File([blob], `${extensionlessName(sourceFile.name)}${suffix}.jpg`, { type: OUTPUT_TYPE, lastModified: sourceFile.lastModified });
}

// Centre square crop, matching the marker's object-fit: cover.
async function renderMarkerFile(bitmap: ImageBitmap, sourceFile: File) {
  const side = Math.min(bitmap.width, bitmap.height);
  const edge = Math.max(1, Math.min(MARKER_EDGE, side));
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
  const blob = await canvasToBlob(canvas, OUTPUT_TYPE, MARKER_QUALITY);
  if (!blob) return null;
  return new File([blob], `${extensionlessName(sourceFile.name)}-marker.jpg`, { type: OUTPUT_TYPE, lastModified: sourceFile.lastModified });
}

/** Marker image cut from an already-rendered thumbnail (video posters). */
export async function prepareMarkerFile(thumbnail: File): Promise<File | null> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(thumbnail);
    return await renderMarkerFile(bitmap, thumbnail);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

export async function preparePhotoFiles(file: File): Promise<PreparedPhotoFiles> {
  const contentType = storedContentType(file);
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined" || !contentType || !CANVAS_TYPES.has(contentType)) {
    return { imageFile: file, thumbnailFile: null, markerFile: null, optimized: false };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const mustReencode = HEIC_TYPES.has(contentType);
    const shouldOptimize = mustReencode || file.size > OPTIMIZE_ABOVE_BYTES || Math.max(bitmap.width, bitmap.height) > MAX_IMAGE_EDGE;
    const [optimizedImage, thumbnail, marker] = await Promise.all([
      shouldOptimize ? renderImageFile(bitmap, file, MAX_IMAGE_EDGE, IMAGE_QUALITY, "") : Promise.resolve(null),
      renderImageFile(bitmap, file, MAX_THUMB_EDGE, THUMB_QUALITY, "-thumb"),
      renderMarkerFile(bitmap, file),
    ]);
    const useOptimized = Boolean(optimizedImage && (mustReencode || optimizedImage.size < file.size));

    return {
      imageFile: useOptimized && optimizedImage ? optimizedImage : file,
      thumbnailFile: thumbnail,
      // The marker path is derived from the thumbnail path, so it only
      // exists alongside a thumbnail.
      markerFile: thumbnail ? marker : null,
      optimized: useOptimized,
    };
  } catch {
    return { imageFile: file, thumbnailFile: null, markerFile: null, optimized: false };
  } finally {
    bitmap?.close();
  }
}
