import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeObjectRequest: vi.fn(),
  presignPut: vi.fn(),
}));

vi.mock("@/lib/object-store-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/object-store-server")>("@/lib/object-store-server");
  return {
    parseNamespace: actual.parseNamespace,
    validObjectPath: actual.validObjectPath,
    objectKey: actual.objectKey,
    authorizeObjectRequest: mocks.authorizeObjectRequest,
    presignPut: mocks.presignPut,
    removeObjects: vi.fn(),
  };
});

const { POST } = await import("./route");

const validBody = {
  namespace: "trip-photos",
  path: "lofoten-2026/abc.jpg",
  contentType: "image/jpeg",
  cacheControl: "31536000",
  contentLength: 1234,
};

function post(body: unknown) {
  return POST(new Request("http://localhost/api/storage/presign", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  mocks.authorizeObjectRequest.mockReset().mockResolvedValue(true);
  mocks.presignPut.mockReset().mockResolvedValue("https://r2.example/signed");
});

describe("POST /api/storage/presign", () => {
  it.each([
    ["bad namespace", { namespace: "secrets" }],
    ["bad path", { path: "../etc/passwd" }],
    ["disallowed content type", { contentType: "text/html" }],
    ["non-integer contentLength", { contentLength: 12.5 }],
    ["string contentLength", { contentLength: "1234" }],
    ["zero contentLength", { contentLength: 0 }],
    ["oversize contentLength", { contentLength: 50 * 1024 * 1024 + 1 }],
  ])("returns 400 for %s", async (_label, overrides) => {
    const response = await post({ ...validBody, ...overrides });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid storage upload request." });
    expect(mocks.authorizeObjectRequest).not.toHaveBeenCalled();
    expect(mocks.presignPut).not.toHaveBeenCalled();
  });

  it("returns 400 for a cacheControl other than one immutable year", async () => {
    const response = await post({ ...validBody, cacheControl: "60" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid cache policy." });
    expect(mocks.authorizeObjectRequest).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not authorized", async () => {
    mocks.authorizeObjectRequest.mockResolvedValue(false);
    const response = await post(validBody);
    expect(response.status).toBe(403);
    expect(mocks.authorizeObjectRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "trip-photos",
      "lofoten-2026/abc.jpg",
      "upload",
    );
    expect(mocks.presignPut).not.toHaveBeenCalled();
  });

  it("returns the presigned URL on success", async () => {
    const response = await post(validBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://r2.example/signed" });
    expect(mocks.presignPut).toHaveBeenCalledWith(validBody);
  });

  it("returns a generic 500 body when presigning throws", async () => {
    mocks.presignPut.mockRejectedValue(new Error("R2_SECRET_ACCESS_KEY is not configured."));
    const response = await post(validBody);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Could not prepare upload." });
    expect(JSON.stringify(body)).not.toContain("R2_SECRET_ACCESS_KEY");
  });
});
