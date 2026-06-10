import type { LngLat } from "@/types/trip";

export type NoteDraft = {
  body: string;
  authorName: string;
  dayId: string | null;
  coordinate: LngLat | null;
  updatedAt: string;
};

const NOTE_DRAFT_PREFIX = "lofoten-note-draft:";

function noteDraftKey(tripSlug: string) {
  return `${NOTE_DRAFT_PREFIX}${tripSlug}`;
}

export function readNoteDraft(tripSlug: string): NoteDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(noteDraftKey(tripSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NoteDraft;
    if (typeof parsed.body !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeNoteDraft(tripSlug: string, draft: NoteDraft) {
  if (typeof window === "undefined") return;
  const empty = !draft.body.trim() && !draft.authorName.trim() && !draft.coordinate;
  if (empty) {
    window.localStorage.removeItem(noteDraftKey(tripSlug));
    return;
  }
  window.localStorage.setItem(noteDraftKey(tripSlug), JSON.stringify(draft));
}

export function clearNoteDraft(tripSlug: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(noteDraftKey(tripSlug));
}
