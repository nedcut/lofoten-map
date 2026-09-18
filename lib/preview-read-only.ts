export const PREVIEW_READ_ONLY_MESSAGE =
  "This preview is view-only. Open the live app to add or edit trip data.";

/**
 * Vercel preview deployments should load real Neon/R2 data but never write it.
 * NEXT_PUBLIC_VERCEL_ENV is inlined into the browser bundle; VERCEL_ENV covers
 * server routes. Demo mode (no backend) is unaffected by this flag.
 */
export function isPreviewReadOnly() {
  return process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"
    || process.env.VERCEL_ENV === "preview";
}

/** Block writes against the shared backend on preview; demo mode stays local. */
export function backendPreviewWriteBlock(backendEnabled: boolean) {
  if (!backendEnabled || !isPreviewReadOnly()) return null;
  return PREVIEW_READ_ONLY_MESSAGE;
}
