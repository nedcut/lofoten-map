import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendClient } from "./backend";
import { AVATAR_BUCKET, deleteObjects, PHOTO_BUCKET, publicObjectUrl, resolveMemberAvatars, uploadObject } from "./object-store";
import type { TripMember } from "@/types/trip";

function backendWithToken(token: string | null = "token-1") {
  return {
    auth: {
      getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
    },
  } as unknown as BackendClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
});

describe("public R2 URLs", () => {
  it("keeps path separators and encodes individual path segments", () => {
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = "https://media.example.com/";
    expect(publicObjectUrl(PHOTO_BUCKET, "lofoten 2026/ø.jpg"))
      .toBe("https://media.example.com/trip-photos/lofoten%202026/%C3%B8.jpg");
  });

  it("resolves member avatars below the avatar namespace", () => {
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL = "https://media.example.com";
    const member = { user_id: "user-1", avatar_path: "user-1/avatar.jpg" } as TripMember;
    expect(resolveMemberAvatars([member])[0].avatar_url)
      .toBe("https://media.example.com/avatars/user-1/avatar.jpg");
  });
});

describe("authenticated object-store requests", () => {
  it("presigns and uploads with immutable conditional-write headers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://r2.example/signed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const file = new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" });
    expect(await uploadObject(backendWithToken(), PHOTO_BUCKET, "lofoten/a.jpg", file)).toEqual({ error: null });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/storage/presign", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      namespace: PHOTO_BUCKET,
      path: "lofoten/a.jpg",
      contentLength: 3,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://r2.example/signed", expect.objectContaining({
      method: "PUT",
      headers: expect.objectContaining({ "If-None-Match": "*" }),
    }));
  });

  it("reports a conditional-write collision as already stored", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://r2.example/signed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 412 })));
    const file = new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" });
    const result = await uploadObject(backendWithToken(), PHOTO_BUCKET, "lofoten/a.jpg", file);
    expect(result.error).toMatchObject({ statusCode: 412, message: "The resource already exists" });
  });

  it("requires an auth session before contacting a storage route", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await deleteObjects(backendWithToken(null), AVATAR_BUCKET, ["user-1/a.jpg"]);
    expect(result.error).toMatchObject({ statusCode: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
