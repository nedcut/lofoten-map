/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the e2e suite build/serve from .next-e2e without touching the dev
  // server's .next directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Auto-memoizes components; matters here because all trip state lives in
  // one Home component, so without it every banner/progress tick re-renders
  // the whole sidebar/sheet/panel tree.
  reactCompiler: true,
};
export default nextConfig;
