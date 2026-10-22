import { describe, expect, it } from "vitest";
import { initialMinimapVisible } from "./journey-minimap";

describe("initialMinimapVisible", () => {
  it("starts hidden on short screens and shown on tall ones when there is no session choice", () => {
    expect(initialMinimapVisible(null, 667)).toBe(false);
    expect(initialMinimapVisible(null, 375)).toBe(false);
    expect(initialMinimapVisible(null, 900)).toBe(true);
  });

  it("honours the choice made earlier in the session over the screen size", () => {
    expect(initialMinimapVisible("1", 375)).toBe(true);
    expect(initialMinimapVisible("0", 900)).toBe(false);
  });
});
