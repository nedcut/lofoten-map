import { TRIP_TIME_ZONE } from "./utils";

export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - instant.getTime();
}

export function tripLocalDateToIso(year: number, month: number, day: number, hour: number, minute: number, second: number): string | null {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const initial = new Date(wallClockAsUtc);
  if (initial.getUTCFullYear() !== year || initial.getUTCMonth() !== month - 1 || initial.getUTCDate() !== day
    || initial.getUTCHours() !== hour || initial.getUTCMinutes() !== minute || initial.getUTCSeconds() !== second) return null;
  let instantMs = wallClockAsUtc - timeZoneOffsetMs(initial, TRIP_TIME_ZONE);
  instantMs = wallClockAsUtc - timeZoneOffsetMs(new Date(instantMs), TRIP_TIME_ZONE);
  return new Date(instantMs).toISOString();
}

const INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** An instant as the trip's wall clock, `YYYY-MM-DDTHH:mm:ss`, for a `datetime-local` input. */
export function tripDateTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  const wallClockAsUtc = instant.getTime() + timeZoneOffsetMs(instant, TRIP_TIME_ZONE);
  return new Date(wallClockAsUtc).toISOString().slice(0, 19);
}

/** Parses a `datetime-local` value (`YYYY-MM-DDTHH:mm[:ss]`) as trip wall-clock time. */
export function tripDateTimeInputToIso(value: string): string | null {
  const match = value.trim().match(INPUT_PATTERN);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "0"] = match;
  return tripLocalDateToIso(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second));
}

/** The instant of 00:00 trip time on a `YYYY-MM-DD` date, or null when the date is invalid. */
export function tripDayStartMs(date: string): number | null {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const iso = tripLocalDateToIso(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, 0);
  return iso === null ? null : Date.parse(iso);
}

/**
 * The `taken_at` to save from the editor. A field left as it was keeps the
 * stored string exactly (seconds and milliseconds included), even if the
 * browser normalised the submitted text; an emptied or unparseable field
 * saves null.
 */
export function resolveEditedTakenAt(submitted: string, initial: string, stored: string | null): string | null {
  if (submitted === initial) return stored;
  const submittedIso = tripDateTimeInputToIso(submitted);
  // A datetime-local input drops zero seconds ("00:30:00" is submitted as
  // "00:30"), so an untouched field can differ from its initial string while
  // still denoting the same second.
  if (submittedIso !== null && submittedIso === tripDateTimeInputToIso(initial)) return stored;
  return submittedIso;
}
