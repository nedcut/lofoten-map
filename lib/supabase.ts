import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Photo, TripMember } from "@/types/trip";

type BrowserSupabaseClient = SupabaseClient | null;

let browserClient: BrowserSupabaseClient | undefined;

function isLocalDemoMode() {
  if (process.env.NEXT_PUBLIC_LOCAL_DEMO_MODE !== "1") return false;
  if (typeof window === "undefined") return true;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;

  if (isLocalDemoMode()) {
    browserClient = null;
    return browserClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return browserClient;
}

export const PHOTO_BUCKET = "trip-photos";
export const AVATAR_BUCKET = "avatars";

/**
 * Pure mapper: resolve each photo's `image_url` / `thumbnail_url` from a
 * `path -> url` lookup. A path missing from the map yields a null URL.
 * Kept separate from the client call so it can be unit-tested directly.
 */
export function normalizePhoto(photo: Photo): Photo {
  return { ...photo, media_type: photo.media_type ?? "photo" };
}

export function applyPublicPhotoUrls(photos: Photo[], urlByPath: Map<string, string>): Photo[] {
  return photos.map((photo) => normalizePhoto({
    ...photo,
    image_url: urlByPath.get(photo.image_path) ?? null,
    thumbnail_url: photo.thumbnail_path ? urlByPath.get(photo.thumbnail_path) ?? null : null,
  }));
}

/**
 * Resolve every photo's storage paths into public URLs. The `trip-photos`
 * bucket is public, so `getPublicUrl` is a synchronous string build with no
 * network call or RLS check — anyone (signed in or not) can render the images.
 * Photos with no paths (e.g. demo rows) come back with null URLs.
 */
export function resolvePhotoUrls(client: SupabaseClient, photos: Photo[]): Photo[] {
  const paths = Array.from(
    new Set(
      photos.flatMap((photo) => [photo.image_path, photo.thumbnail_path]).filter((path): path is string => Boolean(path)),
    ),
  );
  const urlByPath = new Map<string, string>();
  for (const path of paths) {
    const { data } = client.storage.from(PHOTO_BUCKET).getPublicUrl(path);
    if (data?.publicUrl) urlByPath.set(path, data.publicUrl);
  }
  return applyPublicPhotoUrls(photos, urlByPath);
}

/**
 * Resolve each member's `avatar_path` into a public `avatar_url` from the public
 * `avatars` bucket. Same read-time, no-network pattern as `resolvePhotoUrls`;
 * members with no avatar come back with a null URL.
 */
export function resolveMemberAvatars(client: SupabaseClient, members: TripMember[]): TripMember[] {
  return members.map((member) => {
    if (!member.avatar_path) return { ...member, avatar_url: null };
    const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(member.avatar_path);
    return { ...member, avatar_url: data?.publicUrl ?? null };
  });
}
