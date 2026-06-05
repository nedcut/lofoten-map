import ExifReader from "exifreader";

export type ExtractedExif = {
  lat: number | null;
  lng: number | null;
  takenAt: string | null;
  exifFound: boolean;
  message: string;
};

type TagValue = { value?: unknown; description?: string };

function numberFromTag(tag: TagValue | undefined): number | null {
  if (!tag) return null;
  if (typeof tag.value === "number") return tag.value;
  if (typeof tag.description === "string") {
    const parsed = Number(tag.description);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseExifDate(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function extractPhotoExif(file: File): Promise<ExtractedExif> {
  try {
    const tags = (await ExifReader.load(file, { expanded: true })) as Record<string, Record<string, TagValue>>;
    const gps = tags.gps ?? {};
    const exif = tags.exif ?? {};
    const lat = numberFromTag(gps.Latitude ?? gps.GPSLatitude);
    const lng = numberFromTag(gps.Longitude ?? gps.GPSLongitude);
    const dateTag = exif.DateTimeOriginal ?? exif.CreateDate ?? exif.DateTimeDigitized;
    const takenAt = parseExifDate(typeof dateTag?.description === "string" ? dateTag.description : undefined);

    if (lat !== null && lng !== null) {
      return { lat, lng, takenAt, exifFound: true, message: "GPS metadata found. Marker location is ready." };
    }

    return {
      lat: null,
      lng: null,
      takenAt,
      exifFound: Boolean(takenAt),
      message: "No GPS metadata found. Tap the map to place this photo manually.",
    };
  } catch {
    return {
      lat: null,
      lng: null,
      takenAt: null,
      exifFound: false,
      message: "We could not read EXIF metadata. Tap the map to place this photo manually.",
    };
  }
}
