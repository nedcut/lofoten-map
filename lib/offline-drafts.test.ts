import { afterEach, describe, expect, it } from "vitest";
import { clearNoteDraft, readNoteDraft, writeNoteDraft } from "./offline-drafts";

const storage = new Map<string, string>();

afterEach(() => {
  storage.clear();
});

Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  },
  configurable: true,
});

describe("offline note drafts", () => {
  it("round-trips a draft for a trip slug", () => {
    writeNoteDraft("lofoten-2026", {
      body: "Windy ridge",
      authorName: "Ned",
      dayId: "day-1",
      coordinate: { lat: 67.9, lng: 13.0 },
      updatedAt: "2026-07-12T12:00:00.000Z",
    });
    expect(readNoteDraft("lofoten-2026")?.body).toBe("Windy ridge");
  });

  it("clears empty drafts instead of storing them", () => {
    writeNoteDraft("lofoten-2026", {
      body: "temp",
      authorName: "",
      dayId: null,
      coordinate: null,
      updatedAt: "2026-07-12T12:00:00.000Z",
    });
    writeNoteDraft("lofoten-2026", {
      body: "",
      authorName: "",
      dayId: null,
      coordinate: null,
      updatedAt: "2026-07-12T12:00:00.000Z",
    });
    expect(readNoteDraft("lofoten-2026")).toBeNull();
  });

  it("clearNoteDraft removes persisted data", () => {
    writeNoteDraft("lofoten-2026", {
      body: "Keep me briefly",
      authorName: "",
      dayId: null,
      coordinate: null,
      updatedAt: "2026-07-12T12:00:00.000Z",
    });
    clearNoteDraft("lofoten-2026");
    expect(readNoteDraft("lofoten-2026")).toBeNull();
  });

  it("does not throw when storage rejects writes and removals", () => {
    const original = (globalThis as { window: { localStorage: unknown } }).window.localStorage;
    const boom = () => { throw new DOMException("full", "QuotaExceededError"); };
    (globalThis as { window: { localStorage: unknown } }).window.localStorage = {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
    };
    try {
      const draft = {
        body: "Windy ridge",
        authorName: "Ned",
        dayId: null,
        coordinate: null,
        updatedAt: "2026-07-12T12:00:00.000Z",
      };
      expect(() => writeNoteDraft("lofoten-2026", draft)).not.toThrow();
      expect(() => writeNoteDraft("lofoten-2026", { ...draft, body: "", authorName: "" })).not.toThrow();
      expect(() => clearNoteDraft("lofoten-2026")).not.toThrow();
      expect(readNoteDraft("lofoten-2026")).toBeNull();
    } finally {
      (globalThis as { window: { localStorage: unknown } }).window.localStorage = original;
    }
  });
});
