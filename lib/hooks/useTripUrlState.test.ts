// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoDays, demoNotes, demoPhotos, demoTripData } from "@/lib/demo-trip";
import { buildJourneyItems } from "@/lib/journey";
import { useTripUrlState } from "./useTripUrlState";

const allJourneyItems = buildJourneyItems(demoTripData);

function setUrl(search: string) {
  window.history.replaceState(null, "", `/${search}`);
}

function render(loading = false) {
  const onJourneyFromUrl = vi.fn();
  const view = renderHook(
    ({ loading }: { loading: boolean }) => useTripUrlState({ data: demoTripData, allJourneyItems, loading, onJourneyFromUrl }),
    { initialProps: { loading } },
  );
  return { ...view, onJourneyFromUrl };
}

describe("useTripUrlState", () => {
  beforeEach(() => setUrl(""));

  it("waits for the first data load before applying a deep link", () => {
    setUrl(`?day=2&item=photo:${demoPhotos[0].id}`);
    const { result, rerender, onJourneyFromUrl } = render(true);
    expect(result.current.selectedDayId).toBeNull();
    expect(onJourneyFromUrl).not.toHaveBeenCalled();

    rerender({ loading: false });
    expect(result.current.selectedDayId).toBe(demoDays[1].id);
    // A photo deep link opens Journey Mode with filters cleared, not the editor.
    expect(onJourneyFromUrl).toHaveBeenCalledWith(`photo:${demoPhotos[0].id}`, { resetFilters: true });
    expect(result.current.editTargetRef).toBeNull();
  });

  it("applies a journey token only when it names a real item", () => {
    setUrl(`?journey=${allJourneyItems[0].id}`);
    expect(render().onJourneyFromUrl).toHaveBeenLastCalledWith(allJourneyItems[0].id, { resetFilters: false });

    setUrl("?journey=photo:missing");
    expect(render().onJourneyFromUrl).toHaveBeenLastCalledWith(null, { resetFilters: false });
  });

  it("opens the editor for a non-photo item that exists", () => {
    setUrl(`?item=note:${demoNotes[0].id}`);
    const { result } = render();
    expect(result.current.editTargetRef).toEqual({ kind: "note", id: demoNotes[0].id });

    setUrl("?item=note:missing");
    expect(render().result.current.editTargetRef).toBeNull();
  });

  it("writes the selected day to the URL as its day number", () => {
    const { result } = render();
    act(() => result.current.selectDay(demoDays[2].id));
    expect(result.current.selectedDayId).toBe(demoDays[2].id);
    expect(window.location.search).toBe("?day=3");

    act(() => result.current.selectDay(null));
    expect(result.current.selectedDayId).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("pushes the edited item to the URL and drops any journey param", () => {
    setUrl("?journey=photo:x");
    const { result } = render();
    const historyLength = window.history.length;
    act(() => result.current.openEditItem("place", "place-1"));
    expect(result.current.editTargetRef).toEqual({ kind: "place", id: "place-1" });
    expect(window.location.search).toBe("?item=place%3Aplace-1");
    expect(window.history.length).toBe(historyLength + 1);

    act(() => result.current.closeEditItem());
    expect(result.current.editTargetRef).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("re-applies the URL on browser back/forward", () => {
    const { result, onJourneyFromUrl } = render();
    onJourneyFromUrl.mockClear();

    window.history.pushState(null, "", `/?day=1&item=note:${demoNotes[0].id}`);
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(result.current.selectedDayId).toBe(demoDays[0].id);
    expect(result.current.editTargetRef).toEqual({ kind: "note", id: demoNotes[0].id });
    expect(onJourneyFromUrl).toHaveBeenCalledWith(null, { resetFilters: false });
  });
});
