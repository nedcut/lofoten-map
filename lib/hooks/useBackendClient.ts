"use client";

import { useEffect, useState } from "react";
import { isBackendConfigured, loadBackendBrowserClient, type BackendClient } from "@/lib/backend";

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
