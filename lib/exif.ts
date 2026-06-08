import ExifReader from "exifreader";

export type ExtractedExif = {
  lat: number | null;
  lng: number | null;
  takenAt: string | null;
  takenDate: string | null;
  exifFound: boolean;
  message: string;
};

type TagValue = { value?: unknown; description?: string };

function isTagValue(value: unknown): value is TagValue {
  return typeof value === "object" && value !== null && ("value" in value || "description" in value);
}

function rationalToNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number" && value[1] !== 0) {
    return value[0] / value[1];
  }
  return null;
}

function numberFromValue(value: unknown): number | null {
  const rawValue = isTagValue(value) ? value.value : value;
  const direct = rationalToNumber(rawValue);
  if (direct !== null) return direct;

  if (typeof rawValue === "string") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (isTagValue(value) && typeof value.description === "string") {
    const parsed = Number(value.description);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function gpsRefFromValue(value: unknown): string | null {
  const rawValue = isTagValue(value) ? value.value : value;
  if (typeof rawValue === "string") return rawValue;
  if (Array.isArray(rawValue)) return rawValue.join("");
  if (isTagValue(value) && typeof value.description === "string") return value.description;
  return null;
}

function coordinateFromExif(value: unknown, ref: unknown): number | null {
  const direct = numberFromValue(value);
  if (direct !== null) return applyGpsRef(direct, ref);

  const rawValue = isTagValue(value) ? value.value : value;
  if (!Array.isArray(rawValue) || rawValue.length < 3) return null;

  const degrees = rationalToNumber(rawValue[0]);
  const minutes = rationalToNumber(rawValue[1]);
  const seconds = rationalToNumber(rawValue[2]);
  if (degrees === null || minutes === null || seconds === null) return null;

  return applyGpsRef(degrees + minutes / 60 + seconds / 3600, ref);
}

function applyGpsRef(coordinate: number, ref: unknown): number {
  const gpsRef = gpsRefFromValue(ref)?.trim().toUpperCase();
  return gpsRef === "S" || gpsRef === "W" ? -Math.abs(coordinate) : coordinate;
}

function parseExifDate(value: string | undefined): { takenAt: string | null; takenDate: string | null } {
  if (!value) return { takenAt: null, takenDate: null };
  const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const takenDate = normalized.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const parsed = new Date(normalized);
  return { takenAt: Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(), takenDate };
}

export async function extractPhotoExif(file: File): Promise<ExtractedExif> {
  try {
    const tags = (await ExifReader.load(file, { expanded: true })) as Record<string, Record<string, unknown>>;
    const gps = tags.gps ?? {};
    const exif = tags.exif ?? {};
    const lat = coordinateFromExif(gps.Latitude ?? exif.GPSLatitude, exif.GPSLatitudeRef);
    const lng = coordinateFromExif(gps.Longitude ?? exif.GPSLongitude, exif.GPSLongitudeRef);
    const dateTag = exif.DateTimeOriginal ?? exif.CreateDate ?? exif.DateTimeDigitized;
    const { takenAt, takenDate } = parseExifDate(isTagValue(dateTag) && typeof dateTag.description === "string" ? dateTag.description : undefined);

    if (lat !== null && lng !== null) {
      return { lat, lng, takenAt, takenDate, exifFound: true, message: "GPS metadata found. Marker location is ready." };
    }

    return {
      lat: null,
      lng: null,
      takenAt,
      takenDate,
      exifFound: Boolean(takenAt),
      message: "No GPS metadata found. Tap the map to place this photo manually.",
    };
  } catch {
    return {
      lat: null,
      lng: null,
      takenAt: null,
      takenDate: null,
      exifFound: false,
      message: "We could not read EXIF metadata. Tap the map to place this photo manually.",
    };
  }
}
