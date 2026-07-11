import { describe, expect, it, vi } from "vitest";
import { syncJourneyVideo, videoFallbackDurationMs } from "./journey-video";

describe("videoFallbackDurationMs", () => {
  it("tracks media duration and playback speed", () => {
    expect(videoFallbackDurationMs(12, 2)).toBe(6000);
  });

  it("uses a safe fallback before metadata is available", () => {
    expect(videoFallbackDurationMs(Number.NaN, 1)).toBe(30_000);
  });
});

describe("syncJourneyVideo", () => {
  it("explicitly pauses an already-mounted video", () => {
    const pause = vi.fn();
    syncJourneyVideo({ pause, play: vi.fn() }, false, vi.fn());
    expect(pause).toHaveBeenCalledOnce();
  });

  it("plays on resume and reports browser rejection", async () => {
    const rejected = vi.fn();
    const play = vi.fn().mockRejectedValue(new Error("blocked"));
    syncJourneyVideo({ pause: vi.fn(), play }, true, rejected);
    await Promise.resolve();
    expect(play).toHaveBeenCalledOnce();
    expect(rejected).toHaveBeenCalledOnce();
  });
});
