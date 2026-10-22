import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFatalMapError, watchMapInit, type MapInitEmitter } from "./map-init";

function fakeMap() {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  const map = {
    on(type: string, listener: (event?: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    off(type: string, listener: (event?: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string, event?: unknown) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
  return map as typeof map & MapInitEmitter;
}

describe("isFatalMapError", () => {
  const styleFailure = { type: "error", error: Object.assign(new Error("Service Unavailable"), { status: 503 }) };

  it("treats a source-less error before style load (the style request failing) as fatal", () => {
    expect(isFatalMapError(styleFailure, false)).toBe(true);
  });

  it("ignores tile and source errors, which leave a usable map", () => {
    expect(isFatalMapError({ ...styleFailure, sourceId: "mapbox-dem" }, false)).toBe(false);
    expect(isFatalMapError({ ...styleFailure, tile: {} }, false)).toBe(false);
  });

  it("ignores every error once the style has loaded", () => {
    expect(isFatalMapError(styleFailure, true)).toBe(false);
  });
});

describe("watchMapInit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is fatal when the style request errors before the style loads", () => {
    const map = fakeMap();
    const onFatal = vi.fn();
    watchMapInit(map, onFatal, 15_000);
    map.emit("error", { error: new Error("503") });
    map.emit("error", { error: new Error("503 again") });
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(map.listenerCount()).toBe(0);
  });

  it("ignores a source error before the style loads, then still loads", () => {
    const map = fakeMap();
    const onFatal = vi.fn();
    watchMapInit(map, onFatal, 15_000);
    map.emit("error", { error: new Error("tile 503"), sourceId: "composite" });
    map.emit("style.load");
    vi.advanceTimersByTime(60_000);
    expect(onFatal).not.toHaveBeenCalled();
    expect(map.listenerCount()).toBe(0);
  });

  it("is fatal when the style has not loaded by the timeout", () => {
    const map = fakeMap();
    const onFatal = vi.fn();
    watchMapInit(map, onFatal, 15_000);
    vi.advanceTimersByTime(14_999);
    expect(onFatal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFatal).toHaveBeenCalledTimes(1);
  });

  it("ignores tile errors and the timeout once the style has loaded", () => {
    const map = fakeMap();
    const onFatal = vi.fn();
    watchMapInit(map, onFatal, 15_000);
    map.emit("style.load");
    map.emit("error", { error: new Error("tile 503"), sourceId: "composite" });
    vi.advanceTimersByTime(60_000);
    expect(onFatal).not.toHaveBeenCalled();
    expect(map.listenerCount()).toBe(0);
  });

  it("stops watching when disposed before the style loads", () => {
    const map = fakeMap();
    const onFatal = vi.fn();
    const dispose = watchMapInit(map, onFatal, 15_000);
    dispose();
    map.emit("error", { error: new Error("late") });
    vi.advanceTimersByTime(60_000);
    expect(onFatal).not.toHaveBeenCalled();
  });
});
