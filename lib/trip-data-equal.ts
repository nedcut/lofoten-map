import type { TripData } from "@/types/trip";

/**
 * Structural equality for plain JSON-shaped data: primitives, arrays, and
 * object literals. Used to decide whether a background refresh actually
 * changed anything before it replaces React state, because a new object
 * identity alone re-runs every effect and memo keyed on the data.
 */
export function plainDataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    // NaN is the one primitive that is not === itself.
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!plainDataEqual(a[index], b[index])) return false;
    }
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!plainDataEqual(left[key], right[key])) return false;
  }
  return true;
}

/** Keep the previous TripData when a refresh returns identical content. */
export function reuseIfEqual(previous: TripData, next: TripData): TripData {
  return plainDataEqual(previous, next) ? previous : next;
}
