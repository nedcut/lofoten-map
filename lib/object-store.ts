import type { BackendClient } from "@/lib/backend";
import type { Photo, TripMember } from "@/types/trip";

export const PHOTO_BUCKET = "trip-photos";
export const AVATAR_BUCKET = "avatars";
export const IMMUTABLE_CACHE_SECONDS = "31536000";

export type ObjectNamespace = typeof PHOTO_BUCKET | typeof AVATAR_BUCKET;

type StorageError = {
  message: string;
  statusCode?: number;
};

type StorageResult = { error: StorageError | null };

function publicBaseUrl() {
  return process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, "") ?? null;
}

export function publicObjectUrl(namespace: ObjectNamespace, path: string | null): string | null {
  if (!path) return null;
  const baseUrl = publicBaseUrl();
  if (!baseUrl) return null;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/${namespace}/${encodedPath}`;
}

export function resolvePhotoUrls(photos: Photo[]): Photo[] {
  return photos.map((photo) => ({
    ...photo,
    media_type: photo.media_type ?? "photo",
    image_url: publicObjectUrl(PHOTO_BUCKET, photo.image_path),
    thumbnail_url: publicObjectUrl(PHOTO_BUCKET, photo.thumbnail_path),
  }));
}

export function resolveMemberAvatars(members: TripMember[]): TripMember[] {
  return members.map((member) => ({
    ...member,
    avatar_url: publicObjectUrl(AVATAR_BUCKET, member.avatar_path),
  }));
}

async function accessToken(backend: BackendClient): Promise<string | null> {
  const { data } = await backend.auth.getSession();
  return data.session?.access_token ?? null;
}

async function routeRequest(
  backend: BackendClient,
  route: string,
  body: Record<string, unknown>,
): Promise<{ response: Response | null; error: StorageError | null }> {
  const token = await accessToken(backend);
  if (!token) return { response: null, error: { message: "Sign in before changing stored media.", statusCode: 401 } };

  const response = await fetch(route, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (response.ok) return { response, error: null };

  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return {
    response,
    error: { message: payload?.error ?? `Storage request failed (${response.status}).`, statusCode: response.status },
  };
}

export async function uploadObject(
  backend: BackendClient,
  namespace: ObjectNamespace,
  path: string,
  file: Blob,
  options: { contentType?: string; cacheControl?: string } = {},
): Promise<StorageResult> {
  const contentType = options.contentType || file.type || "application/octet-stream";
  const cacheControl = options.cacheControl ?? IMMUTABLE_CACHE_SECONDS;
  const { response, error } = await routeRequest(backend, "/api/storage/presign", {
    namespace,
    path,
    contentType,
    cacheControl,
    contentLength: file.size,
  });
  if (error || !response) return { error };

  const payload = await response.json() as { url: string };
  const upload = await fetch(payload.url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${cacheControl}, immutable`,
      "If-None-Match": "*",
    },
    body: file,
  });
  if (upload.ok) return { error: null };
  return {
    error: {
      message: upload.status === 412 ? "The resource already exists" : `Object upload failed (${upload.status}).`,
      statusCode: upload.status,
    },
  };
}

export async function deleteObjects(
  backend: BackendClient,
  namespace: ObjectNamespace,
  paths: string[],
): Promise<StorageResult> {
  if (paths.length === 0) return { error: null };
  const { error } = await routeRequest(backend, "/api/storage/delete", { namespace, paths });
  return { error };
}
