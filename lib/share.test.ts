import { describe, expect, it, vi } from "vitest";
import { shareJourneyLink } from "./share";

const input = { title: "Lofoten", text: "Relive the trip", url: "https://example.com/?journey=photo%3A1" };

describe("shareJourneyLink", () => {
  it("uses the native share sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    await expect(shareJourneyLink({ share, clipboard: { writeText } }, input)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(input);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the exact deep link when native sharing is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareJourneyLink({ clipboard: { writeText } }, input)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(input.url);
  });

  it("falls back to copying after a native share error", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(shareJourneyLink({ share: vi.fn().mockRejectedValue(new Error("nope")), clipboard: { writeText } }, input)).resolves.toBe("copied");
  });

  it("treats dismissing the native share sheet as cancellation", async () => {
    const writeText = vi.fn();
    const abort = new DOMException("cancelled", "AbortError");
    await expect(shareJourneyLink({ share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } }, input)).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });
});
