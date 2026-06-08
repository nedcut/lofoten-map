const MAX_IMAGE_EDGE = 2200;
const MAX_THUMB_EDGE = 520;
const OPTIMIZE_ABOVE_BYTES = 2.5 * 1024 * 1024;
const OUTPUT_TYPE = "image/jpeg";
const IMAGE_QUALITY = 0.84;
const THUMB_QUALITY = 0.76;
const CANVAS_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PreparedPhotoFiles = {
  imageFile: File;
  thumbnailFile: File | null;
  optimized: boolean;
};

function extensionlessName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "") || "photo";
}

function dimensionsFor(maxEdge: number, width: number, height: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
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

export async function preparePhotoFiles(file: File): Promise<PreparedPhotoFiles> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined" || !CANVAS_TYPES.has(file.type)) {
    return { imageFile: file, thumbnailFile: null, optimized: false };
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const shouldOptimize = file.size > OPTIMIZE_ABOVE_BYTES || Math.max(bitmap.width, bitmap.height) > MAX_IMAGE_EDGE;
    const [optimizedImage, thumbnail] = await Promise.all([
      shouldOptimize ? renderImageFile(bitmap, file, MAX_IMAGE_EDGE, IMAGE_QUALITY, "") : Promise.resolve(null),
      renderImageFile(bitmap, file, MAX_THUMB_EDGE, THUMB_QUALITY, "-thumb"),
    ]);

    return {
      imageFile: optimizedImage && optimizedImage.size < file.size ? optimizedImage : file,
      thumbnailFile: thumbnail,
      optimized: Boolean(optimizedImage && optimizedImage.size < file.size),
    };
  } catch {
    return { imageFile: file, thumbnailFile: null, optimized: false };
  } finally {
    bitmap?.close();
  }
}
