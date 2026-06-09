// Avatars are downscaled and squared client-side before upload so they stay
// tiny and render crisply in small circular frames. Unlike photos (which keep
// their aspect ratio), an avatar is always output as a square JPEG.

const AVATAR_EDGE = 384; // output square is AVATAR_EDGE x AVATAR_EDGE px
const AVATAR_QUALITY = 0.85;
const OUTPUT_TYPE = "image/jpeg";
const CANVAS_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type SquareCrop = { sx: number; sy: number; size: number };

/**
 * Choose the source rectangle to draw onto the square output canvas, given the
 * uploaded image's intrinsic dimensions. Returns the top-left corner (sx, sy)
 * and edge length (size) of a square region within the source image.
 *
 * TODO(you): implement a center crop — take the largest square that fits inside
 * the image and center it, so a 4000x3000 photo yields a 3000x3000 region
 * starting at x=500, y=0. This is the call that decides what a portrait photo
 * looks like once it's forced into a circle: center-crop keeps the middle (the
 * usual "face in the middle" assumption), versus, say, top-anchored to favor
 * heads. Keep it ~4 lines.
 */
export function computeSquareCrop(width: number, height: number): SquareCrop {
  // Replace this placeholder. It currently stretches the whole image into the
  // square (distorting non-square photos) — which is exactly what we don't want.
  return { sx: 0, sy: 0, size: Math.max(width, height) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Turn an arbitrary image File into a small square JPEG avatar. Falls back to
 * the original file if the browser can't decode it via canvas (same defensive
 * posture as preparePhotoFiles).
 */
export async function prepareAvatarFile(file: File): Promise<File> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined" || !CANVAS_TYPES.has(file.type)) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { sx, sy, size } = computeSquareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
    const blob = await canvasToBlob(canvas, OUTPUT_TYPE, AVATAR_QUALITY);
    if (!blob) return file;
    return new File([blob], "avatar.jpg", { type: OUTPUT_TYPE, lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
