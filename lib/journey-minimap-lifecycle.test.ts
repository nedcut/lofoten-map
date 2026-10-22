// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JourneyMiniMap } from "@/components/JourneyMiniMap";
import type { JourneyItem } from "./journey";
import { MAP_STYLE_TIMEOUT_MS } from "./map-init";

const maps = vi.hoisted(() => {
  class MapStub {
    listeners = new Map<string, Set<() => void>>();
    on(event: string, listener: () => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event)!.add(listener);
      return this;
    }
    once(event: string, listener: () => void) {
      const once = () => { this.off(event, once); listener(); };
      return this.on(event, once);
    }
    off(event: string, listener: () => void) { this.listeners.get(event)?.delete(listener); return this; }
    emit(event: string) { for (const listener of [...this.listeners.get(event) ?? []]) listener(); }
    getStyle() { return undefined; }
    getSource() { return undefined; }
    addSource() {}
    setTerrain() {}
    resize() {}
    remove() { this.emit("remove"); }
  }
  const instances: MapStub[] = [];
  return { MapStub, instances };
});

vi.mock("mapbox-gl", () => ({ default: {
  supported: () => true,
  Map: class extends maps.MapStub { constructor() { super(); maps.instances.push(this); } },
} }));

const activeItem: JourneyItem = {
  id: "note", kind: "note", dayId: null, coord: null, attached: [],
  sort: { time: 0, group: 0, created: 0, id: "note" },
  primary: { id: "note", trip_id: "trip", day_id: null, user_id: null, author_name: null,
    lat: 68, lng: 13, body: "A note", note_type: null, created_at: "2026-07-12T00:00:00Z" },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "test-token");
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  maps.instances.length = 0;
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function renderMap() {
  return render(createElement(JourneyMiniMap, { routes: [], days: [], items: [activeItem], activeItem,
    onInteraction: () => {}, onSelectItem: () => {} }));
}

describe("Journey mini-map loading", () => {
  it("keeps the map visible when the style loads but tiles take longer than the timeout", () => {
    const view = renderMap();
    act(() => { maps.instances[0].emit("style.load"); });
    act(() => { vi.advanceTimersByTime(MAP_STYLE_TIMEOUT_MS + 1); });
    expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(view.getByRole("button", { name: "Rotate map left" })).toBeTruthy();
  });

  it("offers Retry when the style never loads", () => {
    const view = renderMap();
    act(() => { vi.advanceTimersByTime(MAP_STYLE_TIMEOUT_MS + 1); });
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
