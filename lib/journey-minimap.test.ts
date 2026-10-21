import { describe, expect, it } from "vitest";
import { initialMinimapVisible, isFatalMinimapError } from "./journey-minimap";

describe("isFatalMinimapError", () => {
  const styleFailure = { type: "error", error: Object.assign(new Error("Service Unavailable"), { status: 503 }) };

  it("treats a source-less error before load (the style request failing) as fatal", () => {
    expect(isFatalMinimapError(styleFailure, false)).toBe(true);
  });

  it("ignores tile and source errors, which leave a usable map", () => {
    expect(isFatalMinimapError({ ...styleFailure, sourceId: "mapbox-dem" }, false)).toBe(false);
    expect(isFatalMinimapError({ ...styleFailure, tile: {} }, false)).toBe(false);
  });

  it("ignores every error once the map has loaded", () => {
    expect(isFatalMinimapError(styleFailure, true)).toBe(false);
  });
});

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
