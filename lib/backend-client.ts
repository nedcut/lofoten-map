import { createClient, SupabaseAuthAdapter } from "@neondatabase/neon-js";

// The only value import of the Neon SDK. lib/backend.ts reaches this module
// through import() so the SDK ships in its own chunk instead of blocking
// hydration of the first page load.
export function createNeonBrowserClient(authUrl: string, dataApiUrl: string) {
  return createClient({
    auth: {
      adapter: SupabaseAuthAdapter(),
      url: authUrl,
      allowAnonymous: true,
    },
    dataApi: { url: dataApiUrl },
  });
}
