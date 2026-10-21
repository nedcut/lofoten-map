"use client";

import { useEffect, useState } from "react";
import { isBackendConfigured, loadBackendBrowserClient, type BackendClient } from "@/lib/backend";

// Start downloading the SDK chunk as soon as this module runs in the browser,
// so it overlaps hydration instead of starting in the first effect. A failure
// here is ignored; the hook below retries and reports it.
if (typeof window !== "undefined") loadBackendBrowserClient().catch(() => {});

/**
 * The Neon client, loaded after hydration. `configured` is known on the first
 * render; `backend` stays null until the SDK chunk arrives, so callers should
 * read `configured` (not `backend`) to decide between demo and live mode.
 */
export function useBackendClient() {
  const [configured] = useState(isBackendConfigured);
  const [backend, setBackend] = useState<BackendClient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    loadBackendBrowserClient().then(
      (client) => {
        if (active) setBackend(client);
      },
      () => {
        if (active) setLoadError("We could not load the trip service. Check your connection and refresh.");
      },
    );
    return () => {
      active = false;
    };
  }, [configured]);

  return { backend, configured, loadError };
}
