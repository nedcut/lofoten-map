import { describe, expect, it } from "vitest";
import { friendlyPersonName, personFilterOptions } from "./display-name";

describe("friendlyPersonName", () => {
  it("passes plain names through trimmed", () => {
    expect(friendlyPersonName("  Maja ")).toBe("Maja");
    expect(friendlyPersonName("Ned Cutler")).toBe("Ned Cutler");
  });

  it("returns null for missing or blank values", () => {
    expect(friendlyPersonName(null)).toBeNull();
    expect(friendlyPersonName(undefined)).toBeNull();
    expect(friendlyPersonName("   ")).toBeNull();
  });

  it("collapses an email to its prettified local part", () => {
    expect(friendlyPersonName("nedcut@gmail.com")).toBe("Nedcut");
    expect(friendlyPersonName("ned.cutler@gmail.com")).toBe("Ned Cutler");
    expect(friendlyPersonName("ned_cutler-jr+trips@example.org")).toBe("Ned Cutler Jr Trips");
  });

  it("keeps digits in the local part", () => {
    expect(friendlyPersonName("maja42@example.com")).toBe("Maja42");
  });

  it("does not treat non-email @ strings as emails", () => {
    expect(friendlyPersonName("@handle")).toBe("@handle");
    expect(friendlyPersonName("me@localhost")).toBe("me@localhost");
  });

  it("falls back to Friend for an empty local part", () => {
    expect(friendlyPersonName("...@example.com")).toBe("Friend");
  });
});

describe("personFilterOptions", () => {
  it("uses opaque ids while retaining the stored value for event handling", () => {
    expect(personFilterOptions(["ned.cutler@example.com", "Maja"])).toEqual([
      { id: "person-1", label: "Maja", value: "Maja" },
      { id: "person-2", label: "Ned Cutler", value: "ned.cutler@example.com" },
    ]);
  });

  it("trims, removes blanks, and deduplicates stored values", () => {
    expect(personFilterOptions([" Maja ", "Maja", "", null])).toEqual([
      { id: "person-1", label: "Maja", value: "Maja" },
    ]);
  });
});
