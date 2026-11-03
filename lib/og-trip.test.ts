import { describe, expect, it } from "vitest";
import { jpegSize, projectRoutes } from "./og-trip";

// A minimal JPEG prefix: SOI, an APP0 segment to skip, then a baseline SOF0
// declaring a 640×480 frame.
function jpegHeader(width: number, height: number) {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0]);
}

describe("jpegSize", () => {
  it("reads the frame size from the start-of-frame segment", () => {
    expect(jpegSize(jpegHeader(640, 480))).toEqual({ width: 640, height: 480 });
    expect(jpegSize(jpegHeader(1080, 1920))).toEqual({ width: 1080, height: 1920 });
  });

  it("rejects bytes that aren't a JPEG", () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe("projectRoutes", () => {
  it("fits every route into the box, preserving shape and centring the short side", () => {
    const [route] = projectRoutes([{ color: "#000", onFoot: true, points: [[13, 68], [13.1, 68], [13.1, 68.1]] }], 300, 300);
    const xs = route.points.map(([x]) => x);
    const ys = route.points.map(([, y]) => y);
    // 0.1° of longitude at 68°N is ~0.37 of 0.1° latitude, so the shape is
    // tall: it fills the height and is centred horizontally.
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(300);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(150);
    // North is up: the northern point has the smallest y.
    expect(route.points[2][1]).toBeLessThan(route.points[1][1]);
  });

  it("returns nothing for no points", () => {
    expect(projectRoutes([], 100, 100)).toEqual([]);
  });
});
