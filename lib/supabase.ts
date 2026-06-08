import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type BrowserSupabaseClient = SupabaseClient | null;

let browserClient: BrowserSupabaseClient | undefined;

function isLocalDemoMode() {
  if (process.env.NEXT_PUBLIC_LOCAL_DEMO_MODE !== "1") return false;
  if (typeof window === "undefined") return false;
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
