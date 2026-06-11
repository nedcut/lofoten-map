import type { QueueItem } from "./upload-queue";

// Best-effort offline persistence for the photo-import queue. Files cannot go
// in localStorage, but IndexedDB stores File blobs natively via structured
// clone, so a tab crash or reload mid-fjord does not lose a selected batch.
// Every function is a silent no-op where IndexedDB is unavailable (SSR, node
// tests, very old browsers) or fails (quota, private mode) — drafts are a
// safety net, never a hard dependency.

export type PhotoDraft = {
  tripSlug: string;
  items: QueueItem[];
  updatedAt: string;
};

const DB_NAME = "lofoten-logbook-drafts";
const STORE_NAME = "photo-queues";

function openDraftDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "tripSlug" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function writePhotoDraft(tripSlug: string, items: QueueItem[]): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  try {
    const draft: PhotoDraft = { tripSlug, items, updatedAt: new Date().toISOString() };
    await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(draft));
  } catch {
    // Structured clone or quota failure — drop the draft silently.
  } finally {
    db.close();
  }
}

export async function readPhotoDraft(tripSlug: string): Promise<PhotoDraft | null> {
  const db = await openDraftDb();
  if (!db) return null;
  try {
    const draft = await requestToPromise(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(tripSlug));
    if (!draft || !Array.isArray((draft as PhotoDraft).items)) return null;
    return draft as PhotoDraft;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function clearPhotoDraft(tripSlug: string): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  try {
    await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(tripSlug));
  } catch {
    // Nothing to clean up if the delete fails; the draft will be overwritten.
  } finally {
    db.close();
  }
}
