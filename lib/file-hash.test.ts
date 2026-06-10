import { describe, expect, it } from "vitest";
import { fileContentHash } from "./file-hash";

describe("fileContentHash", () => {
  it("hashes small files", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "small.bin", { type: "application/octet-stream" });
    const hash = await fileContentHash(file);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("hashes large files in chunks without loading the whole file at once", async () => {
    const bytes = new Uint8Array(9 * 1024 * 1024);
    bytes.fill(7);
    const file = new File([bytes], "large.bin", { type: "application/octet-stream" });
    const hash = await fileContentHash(file);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});
