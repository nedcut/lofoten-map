// The one list of media the app stores. The picker (detectMediaType + size
// checks in UploadPhotoPanel), the upload client (lib/object-store.ts), and
// the presign route all read it, so a file is either rejected at selection
// with a reason or accepted all the way through to R2. The <input accept>
// attributes stay broad (image/*, video/*) because iOS uses them to decide
// which pickers to offer; this list is what actually gates a file.

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

/** Byte cap for a stored content type; null when the type is not accepted. */
export function maxUploadBytesFor(contentType: string): number | null {
  const mediaType = mediaTypeForContentType(contentType);
  return mediaType ? MAX_UPLOAD_BYTES[mediaType] : null;
}
