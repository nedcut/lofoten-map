import type { JourneyItem } from "@/lib/journey";
import { TRIP_TIME_ZONE } from "@/lib/utils";

// A day read as a story: its photos, notes and places in the order they
// happened (the same order Journey Mode plays them). Photos that carry
// words, a caption or a note pinned beside them, get the full column; runs
// of wordless stills sit together as a small grid, the way a printed
// travel journal lays out a contact sheet between paragraphs.

type PhotoItem = Extract<JourneyItem, { kind: "photo" }>;

export type StoryBlock =
  | { kind: "entry"; item: JourneyItem }
  | { kind: "gallery"; items: PhotoItem[] };

function isWordlessStill(item: JourneyItem): item is PhotoItem {
  return item.kind === "photo"
    && item.primary.media_type !== "video"
    && !item.primary.caption?.trim()
    && item.attached.length === 0;
}

export function buildStoryBlocks(items: JourneyItem[]): StoryBlock[] {
  const blocks: StoryBlock[] = [];
  let run: PhotoItem[] = [];
  const flush = () => {
    if (run.length === 1) blocks.push({ kind: "entry", item: run[0] });
    else if (run.length > 1) blocks.push({ kind: "gallery", items: run });
    run = [];
  };
  for (const item of items) {
    if (isWordlessStill(item)) {
      run.push(item);
      continue;
    }
    flush();
    blocks.push({ kind: "entry", item });
  }
  flush();
  return blocks;
}

/** When an item happened, as the trip's wall-clock time ("6:40 PM"), or null. */
export function storyTimeLabel(item: JourneyItem): string | null {
  const value = item.kind === "photo" ? item.primary.taken_at : item.kind === "note" ? item.primary.created_at : null;
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: TRIP_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(date);
}
