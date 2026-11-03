import { describe, expect, it } from "vitest";
import { buildStoryBlocks, storyTimeLabel } from "@/lib/day-story";
import type { JourneyItem } from "@/lib/journey";

let seq = 0;
function photo(overrides: { caption?: string | null; video?: boolean; attached?: boolean; takenAt?: string | null } = {}): JourneyItem {
  const id = `p${seq++}`;
  return {
    id: `photo:${id}`,
    kind: "photo",
    dayId: "d1",
    coord: { lng: 13, lat: 68 },
    primary: { id, caption: overrides.caption ?? null, media_type: overrides.video ? "video" : "photo", taken_at: overrides.takenAt ?? null } as never,
    attached: overrides.attached ? [{ kind: "note", item: { id: "n" } as never }] : [],
    sort: { time: 0, group: 0, created: 0, id },
  };
}
function note(): JourneyItem {
  const id = `n${seq++}`;
  return { id: `note:${id}`, kind: "note", dayId: "d1", coord: null, primary: { id, created_at: "2026-07-12T10:00:00Z" } as never, attached: [], sort: { time: 0, group: 1, created: 0, id } };
}

describe("buildStoryBlocks", () => {
  it("groups runs of wordless stills and keeps everything else full-width", () => {
    const [a, b, c, captioned, d, n, e] = [photo(), photo(), photo(), photo({ caption: "Summit" }), photo(), note(), photo({ video: true })];
    const blocks = buildStoryBlocks([a, b, c, captioned, d, n, e]);
    expect(blocks.map((block) => block.kind === "gallery" ? block.items.map((item) => item.id) : block.item.id)).toEqual([
      [a.id, b.id, c.id],
      captioned.id,
      d.id,
      n.id,
      e.id,
    ]);
  });

  it("treats a photo with a pinned note or a blank caption correctly", () => {
    const [withNote, blank, plain] = [photo({ attached: true }), photo({ caption: "  " }), photo()];
    const blocks = buildStoryBlocks([withNote, blank, plain]);
    expect(blocks).toEqual([{ kind: "entry", item: withNote }, { kind: "gallery", items: [blank, plain] }]);
  });

  it("returns nothing for an empty day", () => {
    expect(buildStoryBlocks([])).toEqual([]);
  });
});

describe("storyTimeLabel", () => {
  it("reads photo times on the trip's clock and skips untimed items", () => {
    expect(storyTimeLabel(photo({ takenAt: "2026-07-12T18:40:00Z" }))).toBe("8:40 PM");
    expect(storyTimeLabel(photo())).toBeNull();
    expect(storyTimeLabel(note())).toBe("12:00 PM");
  });
});
