// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { demoTripData } from "@/lib/demo-trip";
import { buildJourneyItems, type JourneyItem } from "@/lib/journey";
import { useCaptionDraft } from "./useCaptionDraft";

function photoItems(data = demoTripData) {
  return buildJourneyItems(data).filter((item) => item.kind === "photo");
}

describe("useCaptionDraft", () => {
  it("keeps an in-progress draft when the journey items are rebuilt with the same content", () => {
    const [first] = photoItems();
    const { result, rerender } = renderHook(({ item }: { item: JourneyItem }) => useCaptionDraft(item), { initialProps: { item: first } });

    act(() => {
      result.current.setEditingCaption(true);
      result.current.setCaptionDraft("Half-written caption");
    });
    // A poll or someone else's upload rebuilds every item object.
    const [rebuilt] = photoItems({ ...demoTripData, photos: [...demoTripData.photos] });
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.id).toBe(first.id);
    rerender({ item: rebuilt });

    expect(result.current.editingCaption).toBe(true);
    expect(result.current.captionDraft).toBe("Half-written caption");
  });

  it("resets to the saved caption when the viewer moves to another item", () => {
    const [first, second] = photoItems();
    const { result, rerender } = renderHook(({ item }: { item: JourneyItem }) => useCaptionDraft(item), { initialProps: { item: first } });

    act(() => {
      result.current.setEditingCaption(true);
      result.current.setCaptionDraft("Draft for the first photo");
    });
    rerender({ item: second });

    expect(result.current.editingCaption).toBe(false);
    expect(result.current.captionDraft).toBe(second.kind === "photo" ? second.primary.caption ?? "" : "");
  });
});
