// The one list of media the app stores. The picker (detectMediaType + size
// checks in UploadPhotoPanel), the upload client (lib/object-store.ts), and
// the presign route all read it, so a file is either rejected at selection
// with a reason or accepted all the way through to R2. The <input accept>
// attributes stay broad (image/*, video/*) because iOS uses them to decide
// which pickers to offer; this list is what actually gates a file.

import type { ObjectNamespace } from "./object-store";

export type MediaType = "photo" | "video";

type MediaFormat = {
  contentType: string;
  mediaType: MediaType;
  extensions: string[];
  // Other MIME types browsers report for the same bytes.
  aliases?: string[];
};

const MEDIA_FORMATS: MediaFormat[] = [
  { contentType: "image/jpeg", mediaType: "photo", extensions: [".jpg", ".jpeg"], aliases: ["image/jpg", "image/pjpeg"] },
  { contentType: "image/png", mediaType: "photo", extensions: [".png"] },
  { contentType: "image/webp", mediaType: "photo", extensions: [".webp"] },
  { contentType: "image/heic", mediaType: "photo", extensions: [".heic"] },
  { contentType: "image/heif", mediaType: "photo", extensions: [".heif"] },
  { contentType: "video/mp4", mediaType: "video", extensions: [".mp4", ".m4v"], aliases: ["video/x-m4v"] },
  { contentType: "video/quicktime", mediaType: "video", extensions: [".mov"] },
];

// Uploads go straight from the browser to R2 with a presigned PUT, so no
// Vercel body limit applies. Photos are usually re-encoded to a ~2 MB JPEG
// before upload; the cap covers originals the browser cannot re-encode.
// Videos upload unchanged: 200 MB fits about a minute of iPhone 4K/30 HEVC
// while keeping playback (the worker serves whole objects) reasonable.
export const MAX_UPLOAD_BYTES: Record<MediaType, number> = {
  photo: 30 * 1024 * 1024,
  video: 200 * 1024 * 1024,
};

export const UNSUPPORTED_MEDIA_MESSAGE = "Unsupported file type. Use JPG, PNG, WebP, HEIC, MP4, or MOV.";

function formatFor(contentType: string): MediaFormat | null {
  const normalized = contentType.toLowerCase();
  return MEDIA_FORMATS.find((format) => format.contentType === normalized || format.aliases?.includes(normalized)) ?? null;
}

/**
 * The canonical content type to store a file under, or null when the app does
 * not accept it. A reported MIME type wins; an empty or generic one (HEIC
 * files often arrive as "" or application/octet-stream) falls back to the
 * filename extension.
 */
export function storedContentType(file: Blob & { name?: string }): string | null {
  const reported = file.type ? formatFor(file.type) : null;
  if (reported) return reported.contentType;
  if (file.type && file.type !== "application/octet-stream") return null;
  const lowerName = file.name?.toLowerCase() ?? "";
  return MEDIA_FORMATS.find((format) => format.extensions.some((extension) => lowerName.endsWith(extension)))?.contentType ?? null;
}

export function mediaTypeForContentType(contentType: string): MediaType | null {
  return formatFor(contentType)?.mediaType ?? null;
}

// Only Safari decodes HEIC, so the picker accepts it but the browser always
// re-encodes it to JPEG before upload; a stored HEIC would be a broken image
// for everyone else.
export const HEIC_CONTENT_TYPES = new Set(["image/heic", "image/heif"]);

// Thumbnails and map markers are always rendered to JPEG in the browser.
const DERIVED_IMAGE_PATH = /^[^/]+\/(thumbs|markers)\//;

/**
 * Byte cap for uploading contentType to this object, or null when that object
 * may not hold it. Each key holds only what the app writes there, so a member
 * cannot park a video at a thumbnail or avatar key.
 */
export function maxUploadBytesFor(namespace: ObjectNamespace, path: string, contentType: string): number | null {
  const format = formatFor(contentType);
  if (!format || HEIC_CONTENT_TYPES.has(format.contentType)) return null;
  const derivedImage = namespace === "trip-photos" && DERIVED_IMAGE_PATH.test(path);
  if (derivedImage && format.contentType !== "image/jpeg") return null;
  if ((derivedImage || namespace === "avatars") && format.mediaType !== "photo") return null;
  return MAX_UPLOAD_BYTES[format.mediaType];
}
