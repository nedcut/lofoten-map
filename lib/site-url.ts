const DEFAULT_SITE_URL = "https://lofoten-map-kappa.vercel.app";

function withProtocol(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function siteUrl(env: Record<string, string | undefined> = process.env) {
  const configured = env.NEXT_PUBLIC_SITE_URL
    ?? env.VERCEL_PROJECT_PRODUCTION_URL
    ?? env.VERCEL_URL
    ?? DEFAULT_SITE_URL;
  try {
    return new URL(withProtocol(configured));
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}
