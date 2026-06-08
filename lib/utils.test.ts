import { describe, it, expect } from "vitest";
import { cn, formatDateOnly, formatDateTime } from "./utils";

describe("cn", () => {
  it("merges conditional class names", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("lets later Tailwind utilities win over conflicting earlier ones", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("formatDateTime", () => {
  it("returns a placeholder for empty input", () => {
    expect(formatDateTime(null)).toBe("Unknown time");
    expect(formatDateTime(undefined)).toBe("Unknown time");
  });

  it("formats an ISO instant into a readable string", () => {
    // Exact wording is locale-fixed (en-US); assert the stable parts.
    const formatted = formatDateTime("2026-06-08T14:30:00Z");
    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/Jun/);
  });
});

describe("formatDateOnly", () => {
  it("returns an empty string for empty input", () => {
    expect(formatDateOnly(null)).toBe("");
    expect(formatDateOnly(undefined)).toBe("");
  });

  it("formats a plain calendar date without timezone drift", () => {
    // A date-only string must render as that same calendar day regardless of TZ.
    expect(formatDateOnly("2026-06-08")).toBe("Jun 8");
  });

  it("uses the date portion of a full timestamp", () => {
    expect(formatDateOnly("2026-12-25T23:59:00Z")).toBe("Dec 25");
  });
});
