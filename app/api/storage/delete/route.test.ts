import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeObjectRequest: vi.fn(),
  removeObjects: vi.fn(),
}));

vi.mock("@/lib/object-store-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/object-store-server")>("@/lib/object-store-server");
  return {
    parseNamespace: actual.parseNamespace,
    validObjectPath: actual.validObjectPath,
    objectKey: actual.objectKey,
    authorizeObjectRequest: mocks.authorizeObjectRequest,
    presignPut: vi.fn(),
    removeObjects: mocks.removeObjects,
  };
});

const { POST } = await import("./route");

const paths = ["lofoten-2026/abc.jpg", "lofoten-2026/thumbs/abc.jpg"];

function post(body: unknown) {
  return POST(new Request("http://localhost/api/storage/delete", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  mocks.authorizeObjectRequest.mockReset().mockResolvedValue(true);
  mocks.removeObjects.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/storage/delete", () => {
  it.each([
    ["bad namespace", { namespace: "secrets", paths }],
    ["non-array paths", { namespace: "trip-photos", paths: paths[0] }],
    ["empty paths", { namespace: "trip-photos", paths: [] }],
    ["more than 100 paths", { namespace: "trip-photos", paths: Array.from({ length: 101 }, (_, i) => `slug/${i}.jpg`) }],
    ["one invalid path", { namespace: "trip-photos", paths: [...paths, "../etc/passwd"] }],
  ])("returns 400 for %s", async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid storage delete request." });
    expect(mocks.authorizeObjectRequest).not.toHaveBeenCalled();
    expect(mocks.removeObjects).not.toHaveBeenCalled();
  });

  it("returns 403 when any path is unauthorized", async () => {
    mocks.authorizeObjectRequest.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await post({ namespace: "trip-photos", paths });
    expect(response.status).toBe(403);
    expect(mocks.authorizeObjectRequest).toHaveBeenCalledTimes(2);
    expect(mocks.authorizeObjectRequest).toHaveBeenCalledWith(expect.any(Request), "trip-photos", paths[1], "delete");
    expect(mocks.removeObjects).not.toHaveBeenCalled();
  });

  it("deletes and returns ok on success", async () => {
    const response = await post({ namespace: "avatars", paths });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.removeObjects).toHaveBeenCalledWith("avatars", paths);
  });

  it("returns a generic 500 body when deletion throws", async () => {
    mocks.removeObjects.mockRejectedValue(new Error("lofoten-2026/abc.jpg: AccessDenied"));
    const response = await post({ namespace: "trip-photos", paths });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "Could not delete objects." });
    expect(JSON.stringify(body)).not.toContain("AccessDenied");
  });
});
