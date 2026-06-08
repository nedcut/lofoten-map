import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type BrowserSupabaseClient = SupabaseClient | null;

let browserClient: BrowserSupabaseClient | undefined;

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;

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
