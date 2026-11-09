export type StorageKind = "local" | "session";

// Browsers can block site storage (accessing the property itself throws a
// SecurityError), omit it entirely, or reject writes when the quota is full.
// Node 25+ also defines its own `globalThis.localStorage` (undefined without a
// flag). Every helper here swallows those cases instead of throwing.
function getStorage(kind: StorageKind): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return (kind === "local" ? window.localStorage : window.sessionStorage) ?? null;
  } catch {
    return null;
  }
}

export function readStorage(kind: StorageKind, key: string): string | null {
  try {
    return getStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(kind: StorageKind, key: string, value: string): void {
  try {
    getStorage(kind)?.setItem(key, value);
  } catch {
    // Storage blocked or full: the value simply isn't remembered.
  }
}

export function removeStorage(kind: StorageKind, key: string): void {
  try {
    getStorage(kind)?.removeItem(key);
  } catch {
    // Storage blocked: nothing to remove.
  }
}
