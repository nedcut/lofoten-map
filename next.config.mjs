/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the e2e suite build/serve from .next-e2e without touching the dev
  // server's .next directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
