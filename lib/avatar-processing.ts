// Avatars are downscaled and squared client-side before upload so they stay
// tiny and render crisply in small circular frames. Unlike photos (which keep
// their aspect ratio), an avatar is always output as a square JPEG.

import { HEIC_CONTENT_TYPES, storedContentType } from "./media-formats";

const AVATAR_EDGE = 384; // output square is AVATAR_EDGE x AVATAR_EDGE px
const AVATAR_QUALITY = 0.85;
const OUTPUT_TYPE = "image/jpeg";
// HEIC decodes only in Safari; converting it here is what lets an iPhone photo
// become an avatar at all, since the upload route refuses raw HEIC.
const CANVAS_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const HEIC_CONVERSION_ERROR = "Could not convert HEIC/HEIF to JPEG. Export it as JPEG and try again.";

export type SquareCrop = { sx: number; sy: number; size: number };

/**
 * Choose the source rectangle to draw onto the square output canvas, given the
 * uploaded image's intrinsic dimensions: the largest centered square, so a
 * 4000x3000 photo yields a 3000x3000 region starting at x=500, y=0.
 */
export function computeSquareCrop(width: number, height: number): SquareCrop {
  const size = Math.min(width, height);
  return { sx: Math.round((width - size) / 2), sy: Math.round((height - size) / 2), size };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Turn an arbitrary image File into a small square JPEG avatar. Falls back to
 * the original file if the browser can't decode it via canvas (same defensive
 * posture as preparePhotoFiles), except HEIC, which must convert or fail.
 */
export async function prepareAvatarFile(file: File): Promise<File> {
  const contentType = storedContentType(file);
  const mustConvert = HEIC_CONTENT_TYPES.has(contentType ?? "");
  const original = () => {
    if (mustConvert) throw new Error(HEIC_CONVERSION_ERROR);
    return file;
  };
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined" || !CANVAS_TYPES.has(contentType ?? "")) {
    return original();
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { sx, sy, size } = computeSquareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    const context = canvas.getContext("2d");
    if (!context) return original();
    context.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
    const blob = await canvasToBlob(canvas, OUTPUT_TYPE, AVATAR_QUALITY);
    if (!blob) return original();
    return new File([blob], "avatar.jpg", { type: OUTPUT_TYPE, lastModified: Date.now() });
  } catch (error) {
    if (mustConvert) throw new Error(HEIC_CONVERSION_ERROR, { cause: error });
    return file;
  } finally {
    bitmap?.close();
  }
}
