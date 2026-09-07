/**
 * Origins for the Content-Security-Policy, derived from the same public env
 * the browser bundle uses. Unset or unparseable values are skipped so a
 * misconfigured env can never produce an invalid header.
 */
function envOrigin(name) {
  const value = process.env[name];
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function contentSecurityPolicy() {
  const neonAuth = envOrigin("NEXT_PUBLIC_NEON_AUTH_URL");
  const neonDataApi = envOrigin("NEXT_PUBLIC_NEON_DATA_API_URL");
  const r2 = envOrigin("NEXT_PUBLIC_R2_PUBLIC_URL");
  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://va.vercel-scripts.com"],
    "style-src": ["'self'", "'unsafe-inline'", "https://api.mapbox.com"],
    "img-src": ["'self'", "data:", "blob:", "https://*.mapbox.com", r2],
    "media-src": ["'self'", "blob:", r2],
    "connect-src": [
      "'self'",
      "https://*.mapbox.com",
      "https://events.mapbox.com",
      "https://va.vercel-scripts.com",
      "https://vitals.vercel-insights.com",
      neonAuth,
      neonDataApi,
      r2,
    ],
    "worker-src": ["'self'", "blob:"],
    "child-src": ["blob:"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([directive, sources]) => `${directive} ${[...new Set(sources.filter(Boolean))].join(" ")}`)
    .join("; ");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Report-only for now: the browser logs violations to the console without
  // blocking anything. Promote to Content-Security-Policy once the policy has
  // been validated against real Mapbox, Neon, R2, and Vercel traffic.
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy() },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the e2e suite build/serve from .next-e2e without touching the dev
  // server's .next directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Auto-memoizes components; matters here because all trip state lives in
  // one Home component, so without it every banner/progress tick re-renders
  // the whole sidebar/sheet/panel tree.
  reactCompiler: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
export default nextConfig;
