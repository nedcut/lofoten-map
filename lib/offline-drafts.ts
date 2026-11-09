import type { LngLat } from "@/types/trip";
import { readStorage, removeStorage, writeStorage } from "@/lib/safe-storage";

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
  try {
    const raw = readStorage("local", noteDraftKey(tripSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NoteDraft;
    if (typeof parsed.body !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeNoteDraft(tripSlug: string, draft: NoteDraft) {
  const empty = !draft.body.trim() && !draft.authorName.trim() && !draft.coordinate;
  if (empty) {
    removeStorage("local", noteDraftKey(tripSlug));
    return;
  }
  writeStorage("local", noteDraftKey(tripSlug), JSON.stringify(draft));
}

export function clearNoteDraft(tripSlug: string) {
  removeStorage("local", noteDraftKey(tripSlug));
}
