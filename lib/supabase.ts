import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Photo } from "@/types/trip";

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

// The bucket is private, so images are served through short-lived signed URLs
// minted at read time. Eight hours covers a day's browsing session; nothing
// that expires is ever persisted, so this is a one-constant tuning knob.
export const PHOTO_SIGNED_URL_TTL_SECONDS = 8 * 60 * 60;

/**
 * Pure mapper: resolve each photo's signed `image_url` / `thumbnail_url` from a
 * `path -> signedUrl` lookup. A path missing from the map yields a null URL.
 * Kept separate from the async client call so it can be unit-tested directly.
 */
export function applySignedPhotoUrls(photos: Photo[], signedByPath: Map<string, string>): Photo[] {
  return photos.map((photo) => ({
    ...photo,
    image_url: signedByPath.get(photo.image_path) ?? null,
    thumbnail_url: photo.thumbnail_path ? signedByPath.get(photo.thumbnail_path) ?? null : null,
  }));
}

/**
 * Batch-sign every photo's storage paths into URLs. Returns photos with null
 * URLs when there are no paths to sign (e.g. demo rows). Relies on the
 * member-scoped SELECT policy on `storage.objects` to authorize signing.
 */
export async function signPhotoUrls(client: SupabaseClient, photos: Photo[]): Promise<Photo[]> {
  const paths = Array.from(
    new Set(
      photos.flatMap((photo) => [photo.image_path, photo.thumbnail_path]).filter((path): path is string => Boolean(path)),
    ),
  );
  if (paths.length === 0) return applySignedPhotoUrls(photos, new Map());

  const { data } = await client.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_SIGNED_URL_TTL_SECONDS);
  const signedByPath = new Map<string, string>();
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl);
  }
  return applySignedPhotoUrls(photos, signedByPath);
}
