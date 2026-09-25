import type { createNeonBrowserClient } from "@/lib/backend-client";

export type BackendClient = ReturnType<typeof createNeonBrowserClient>;
type BackendSessionResponse = Awaited<ReturnType<BackendClient["auth"]["getSession"]>>;
type BackendSession = NonNullable<NonNullable<BackendSessionResponse["data"]>["session"]>;
export type BackendUser = BackendSession["user"];

let browserClient: Promise<BackendClient | null> | undefined;

function isLocalDemoMode() {
  if (process.env.NEXT_PUBLIC_LOCAL_DEMO_MODE !== "1") return false;
  if (typeof window === "undefined") return true;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function backendUrls() {
  if (isLocalDemoMode()) return null;
  const authUrl = process.env.NEXT_PUBLIC_NEON_AUTH_URL;
  const dataApiUrl = process.env.NEXT_PUBLIC_NEON_DATA_API_URL;
  if (!authUrl || !dataApiUrl) return null;
  return { authUrl, dataApiUrl };
}

/**
 * Whether this build talks to Neon. False is intentional in local demo mode
 * and when the public Neon endpoints have not been configured. Synchronous so
 * the first render can tell "client still loading" apart from demo mode.
 */
export function isBackendConfigured() {
  return backendUrls() !== null;
}

/** Load (once) the single browser-side Neon client, or null when not configured. */
export function loadBackendBrowserClient(): Promise<BackendClient | null> {
  if (browserClient) return browserClient;
  const urls = backendUrls();
  if (!urls) {
    browserClient = Promise.resolve(null);
    return browserClient;
  }

  // Preview reads stay on this origin because Neon intermittently omits CORS
  // headers for preview origins. The route only forwards GETs for trip tables.
  const readUrl = typeof window !== "undefined" && process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"
    ? new URL("/api/preview-data", window.location.origin).toString()
    : urls.dataApiUrl;
  browserClient = import("@/lib/backend-client")
    .then(({ createNeonBrowserClient }) => createNeonBrowserClient(urls.authUrl, readUrl))
    .catch((error: unknown) => {
      // Let a later call retry a chunk that failed to download.
      browserClient = undefined;
      throw error;
    });
  return browserClient;
}
