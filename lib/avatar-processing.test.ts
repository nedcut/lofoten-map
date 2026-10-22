import { describe, expect, it } from "vitest";
import { computeSquareCrop } from "./avatar-processing";

describe("computeSquareCrop", () => {
  it("takes the largest centered square, so the avatar is cropped rather than stretched", () => {
    expect(computeSquareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, size: 3000 });
    expect(computeSquareCrop(3000, 4000)).toEqual({ sx: 0, sy: 500, size: 3000 });
    expect(computeSquareCrop(512, 512)).toEqual({ sx: 0, sy: 0, size: 512 });
  });
});
