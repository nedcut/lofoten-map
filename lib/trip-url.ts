import type { Day } from "@/types/trip";

export type MapItemRef = { kind: "photo" | "note" | "place" | "route"; id: string };

const ITEM_KINDS = new Set<MapItemRef["kind"]>(["photo", "note", "place", "route"]);

/** Parse `photo:uuid` style tokens used in journey mode and deep links. */
export function parseItemToken(token: string | null | undefined): MapItemRef | null {
  if (!token) return null;
  const separator = token.indexOf(":");
  if (separator <= 0) return null;
  const kind = token.slice(0, separator) as MapItemRef["kind"];
  const id = token.slice(separator + 1);
  if (!ITEM_KINDS.has(kind) || !id) return null;
  return { kind, id };
}

/** Serialize a map item reference for URL params. */
export function formatItemToken(ref: MapItemRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Resolve a `day` URL param to a day id. Accepts a day number (`3`) or a day
 * uuid. Returns null when the param is absent or does not match any day.
 */
export function resolveDayParam(param: string | null | undefined, days: Day[]): string | null {
  if (!param) return null;
  const byNumber = days.find((day) => String(day.day_number) === param);
  if (byNumber) return byNumber.id;
  const byId = days.find((day) => day.id === param);
  return byId?.id ?? null;
}

/** Day number for a shareable URL, or the id when the day is unknown. */
export function formatDayParam(dayId: string | null, days: Day[]): string | null {
  if (!dayId) return null;
  const day = days.find((entry) => entry.id === dayId);
  return day ? String(day.day_number) : dayId;
}

export type TripUrlState = {
  day: string | null;
  journey: string | null;
  item: string | null;
};

export function readTripUrlState(href: string): TripUrlState {
  const params = new URL(href).searchParams;
  return {
    day: params.get("day"),
    journey: params.get("journey"),
    item: params.get("item"),
  };
}

export function applyTripUrlState(href: string, patch: Partial<TripUrlState>, mode: "push" | "replace" = "replace"): string {
  const url = new URL(href);
  for (const key of ["day", "journey", "item"] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (typeof window !== "undefined") {
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", next);
  }
  return next;
}
