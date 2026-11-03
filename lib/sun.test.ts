import { describe, expect, it } from "vitest";
import { nightLight, solarElevationDeg } from "./sun";

describe("solarElevationDeg", () => {
  it("puts the sun high at a temperate midsummer noon and below the horizon at midnight", () => {
    // Greenwich, June solstice: noon elevation is 90 - 51.48 + 23.44 ≈ 62°.
    expect(solarElevationDeg(new Date("2026-06-21T12:00:00Z"), 51.48, 0)).toBeCloseTo(61.9, 0);
    expect(solarElevationDeg(new Date("2026-06-21T00:00:00Z"), 51.48, 0)).toBeLessThan(-10);
  });

  it("keeps the sun above the horizon at midnight north of the Arctic Circle in June", () => {
    // Tromsø's lower culmination at the solstice is about 69.65 + 23.44 - 90 ≈ 3°.
    expect(solarElevationDeg(new Date("2026-06-21T23:00:00Z"), 69.65, 18.96)).toBeGreaterThan(2);
  });
});

describe("nightLight", () => {
  it("calls out the midnight sun in the small hours of an Arctic June", () => {
    expect(nightLight("2026-06-22T00:30:00+02:00", 69.65, 18.96)).toBe("midnight-sun");
  });

  it("calls a sunless but undark night a bright night", () => {
    // Trondheim at solar midnight on the solstice: about -3°, civil twilight.
    expect(nightLight("2026-06-21T23:30:00Z", 63.43, 10.4)).toBe("bright-night");
  });

  it("says nothing in the daytime, on a dark night, or without a time", () => {
    expect(nightLight("2026-06-21T12:00:00+02:00", 69.65, 18.96)).toBeNull();
    expect(nightLight("2026-06-21T22:00:00Z", 41.9, 12.5)).toBeNull();
    expect(nightLight("2026-12-21T23:00:00Z", 69.65, 18.96)).toBeNull();
    expect(nightLight(null, 69.65, 18.96)).toBeNull();
    expect(nightLight("not a date", 69.65, 18.96)).toBeNull();
  });
});
