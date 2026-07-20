import { createClient, SupabaseAuthAdapter } from "@neondatabase/neon-js";

function createNeonBrowserClient(authUrl: string, dataApiUrl: string) {
  return createClient({
    auth: {
      adapter: SupabaseAuthAdapter(),
      url: authUrl,
      allowAnonymous: true,
    },
    dataApi: { url: dataApiUrl },
  });
}

export type BackendClient = ReturnType<typeof createNeonBrowserClient>;
type BackendSessionResponse = Awaited<ReturnType<BackendClient["auth"]["getSession"]>>;
type BackendSession = NonNullable<NonNullable<BackendSessionResponse["data"]>["session"]>;
export type BackendUser = BackendSession["user"];

let browserClient: BackendClient | null | undefined;

function isLocalDemoMode() {
  if (process.env.NEXT_PUBLIC_LOCAL_DEMO_MODE !== "1") return false;
  if (typeof window === "undefined") return true;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

/**
 * Return the single browser-side Neon client. A null client is intentional in
 * local demo mode and when the public Neon endpoints have not been configured.
 */
export function getBackendBrowserClient(): BackendClient | null {
  if (browserClient !== undefined) return browserClient;

  if (isLocalDemoMode()) {
    browserClient = null;
    return browserClient;
  }

  const authUrl = process.env.NEXT_PUBLIC_NEON_AUTH_URL;
  const dataApiUrl = process.env.NEXT_PUBLIC_NEON_DATA_API_URL;
  if (!authUrl || !dataApiUrl) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createNeonBrowserClient(authUrl, dataApiUrl);
  return browserClient;
}
