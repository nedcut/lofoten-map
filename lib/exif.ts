import ExifReader from "exifreader";

export type ExtractedExif = {
  lat: number | null;
  lng: number | null;
  takenAt: string | null;
  takenDate: string | null;
  exifFound: boolean;
  message: string;
  /** Whether the capture instant came with its own offset or needed the trip timezone assumption. */
  timeZoneSource?: "embedded" | "trip-local" | null;
  /** Batch correction already applied to a timezone-less camera clock. */
  clockCorrectionHours?: number;
};

type TagValue = { value?: unknown; description?: string };

const TRIP_TIME_ZONE = "Europe/Oslo";

const tripDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TRIP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

function stringFromTag(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (!isTagValue(value)) return undefined;
  if (typeof value.description === "string") return value.description;
  if (typeof value.value === "string") return value.value;
  return undefined;
}

export function coordinateFromExif(value: unknown, ref: unknown): number | null {
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

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - instant.getTime();
}

// Accepts EXIF OffsetTime* values ("+02:00", "-0400") and the trailing zone
// designators found inside video creation timestamps ("Z", "UTC").
function normalizeUtcOffset(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^(?:Z|UTC|GMT)$/i.test(trimmed)) return "+00:00";
  const match = trimmed.match(/^([+-])(\d{2}):?(\d{2})$/);
  return match ? `${match[1]}${match[2]}:${match[3]}` : null;
}

function tripLocalDateToIso(year: number, month: number, day: number, hour: number, minute: number, second: number): string | null {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const initial = new Date(wallClockAsUtc);
  if (initial.getUTCFullYear() !== year || initial.getUTCMonth() !== month - 1 || initial.getUTCDate() !== day
    || initial.getUTCHours() !== hour || initial.getUTCMinutes() !== minute || initial.getUTCSeconds() !== second) return null;
  let instantMs = wallClockAsUtc - timeZoneOffsetMs(initial, TRIP_TIME_ZONE);
  instantMs = wallClockAsUtc - timeZoneOffsetMs(new Date(instantMs), TRIP_TIME_ZONE);
  return new Date(instantMs).toISOString();
}

export function parseExifDate(value: string | undefined, offset?: string): { takenAt: string | null; takenDate: string | null; timeZoneSource: "embedded" | "trip-local" | null } {
  if (!value) return { takenAt: null, takenDate: null, timeZoneSource: null };

  const trimmed = value.trim();
  const localDateTime = trimmed.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (localDateTime) {
    const [, year, month, day, hour, minute, second = "00"] = localDateTime;
    // A zone designator trailing the datetime itself (video creation times are
    // often "...T14:30:00Z") is as authoritative as a separate OffsetTime* tag.
    const trailing = trimmed.slice(localDateTime[0].length).replace(/^\.\d+/, "");
    const explicitOffset = normalizeUtcOffset(offset) ?? normalizeUtcOffset(trailing);
    const validTripLocalInstant = tripLocalDateToIso(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second));
    const explicitInstant = explicitOffset ? new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${explicitOffset}`) : null;
    const explicitIso = explicitInstant && !Number.isNaN(explicitInstant.getTime()) ? explicitInstant.toISOString() : null;
    const takenAt = validTripLocalInstant ? explicitIso ?? validTripLocalInstant : null;
    return {
      takenAt,
      takenDate: `${year}-${month}-${day}`,
      timeZoneSource: takenAt ? (explicitIso ? "embedded" : "trip-local") : null,
    };
  }

  const localDate = trimmed.match(/^(\d{4})[:-](\d{2})[:-](\d{2})$/);
  if (localDate) {
    const [, year, month, day] = localDate;
    const takenAt = tripLocalDateToIso(Number(year), Number(month), Number(day), 0, 0, 0);
    return {
      takenAt,
      takenDate: `${year}-${month}-${day}`,
      timeZoneSource: takenAt ? "trip-local" : null,
    };
  }

  const normalized = trimmed.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const takenDate = normalized.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  const parsed = new Date(normalized);
  const takenAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  return {
    takenAt,
    takenDate,
    timeZoneSource: takenAt ? (/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(normalized) ? "embedded" : "trip-local") : null,
  };
}

function dateInTripTimeZone(iso: string): string | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = tripDateFormatter.formatToParts(parsed);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/** Apply an hour correction only to EXIF times that did not include a timezone. */
export function correctCameraClock(exif: ExtractedExif, hours: number): ExtractedExif {
  if (exif.timeZoneSource !== "trip-local" || !exif.takenAt || !Number.isFinite(hours)) return exif;
  const previousHours = exif.clockCorrectionHours ?? 0;
  if (hours === previousHours) return exif;
  const correctedMs = new Date(exif.takenAt).getTime() + (hours - previousHours) * 60 * 60 * 1000;
  if (!Number.isFinite(correctedMs)) return exif;
  const takenAt = new Date(correctedMs).toISOString();
  return { ...exif, takenAt, takenDate: dateInTripTimeZone(takenAt), clockCorrectionHours: hours };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("EXIF read timed out")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function extractPhotoExif(file: File, options?: { mediaType?: "photo" | "video" }): Promise<ExtractedExif> {
  const label = options?.mediaType === "video" ? "video" : "photo";
  try {
    // Cap the read so a single corrupt/huge file in a big batch can never hang
    // the queue (which would otherwise leave items stuck "reading" forever).
    const tags = (await withTimeout(ExifReader.load(file, { expanded: true }), 15000)) as Record<string, Record<string, unknown>>;
    const gps = tags.gps ?? {};
    const exif = tags.exif ?? {};
    const lat = coordinateFromExif(gps.Latitude ?? gps.GPSLatitude ?? exif.GPSLatitude, gps.LatitudeRef ?? gps.GPSLatitudeRef ?? exif.GPSLatitudeRef);
    const lng = coordinateFromExif(gps.Longitude ?? gps.GPSLongitude ?? exif.GPSLongitude, gps.LongitudeRef ?? gps.GPSLongitudeRef ?? exif.GPSLongitudeRef);
    const dateTag = exif.DateTimeOriginal ?? exif.CreateDate ?? exif.DateTimeDigitized;
    const offsetTag = exif.OffsetTimeOriginal ?? exif.OffsetTime ?? exif.TimeZoneOffset;
    const offset = stringFromTag(offsetTag);
    const { takenAt, takenDate, timeZoneSource } = parseExifDate(stringFromTag(dateTag), offset);

    if (lat !== null && lng !== null) {
      return { lat, lng, takenAt, takenDate, exifFound: true, message: "GPS metadata found. Marker location is ready.", timeZoneSource, clockCorrectionHours: 0 };
    }

    return {
      lat: null,
      lng: null,
      takenAt,
      takenDate,
      exifFound: Boolean(takenAt),
      message: `No GPS metadata found. Tap the map to place this ${label} manually.`,
      timeZoneSource,
      clockCorrectionHours: 0,
    };
  } catch {
    return {
      lat: null,
      lng: null,
      takenAt: null,
      takenDate: null,
      exifFound: false,
      message: `We could not read metadata. Tap the map to place this ${label} manually.`,
      timeZoneSource: null,
      clockCorrectionHours: 0,
    };
  }
}
