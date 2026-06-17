/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the e2e suite build/serve from .next-e2e without touching the dev
  // server's .next directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Auto-memoizes components; matters here because all trip state lives in
  // one Home component, so without it every banner/progress tick re-renders
  // the whole sidebar/sheet/panel tree.
  reactCompiler: true,
  // Keep large, component-heavy packages from being pulled in wholesale when a
  // page only needs a few exports. This trims the eagerly loaded UI bundle
  // without changing runtime behavior.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      {
        source: "/:all*(svg|jpg|jpeg|png|gif|webp|avif|ico)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
