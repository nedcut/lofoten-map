import type { Metadata, Viewport } from "next";
import { Fragment, type ReactNode } from "react";
import { Fraunces, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: "Lofoten Logbook",
  description: "A collaborative map and journal for a Lofoten hiking trip.",
  openGraph: { title: "Lofoten Logbook", description: "Relive a shared journey through Norway's Lofoten Islands.", type: "website", images: ["/opengraph-image"] },
  twitter: { card: "summary_large_image", title: "Lofoten Logbook", description: "Relive a shared journey through Norway's Lofoten Islands.", images: ["/opengraph-image"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e7efe8",
  viewportFit: "cover",
};

// Self-hosted by next/font: the files are downloaded at build time and served
// from this origin, so there is still no runtime request to a font host.
// Fraunces carries the journal-like display type (titles, day names, Journey
// captions); Inter is the quiet workhorse for everything else.
const displayFont = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT"], variable: "--font-fraunces", display: "swap" });
const bodyFont = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// Origins of the Neon API and R2 public media endpoint. Preconnecting warms the
// TLS handshakes before the first data and gallery requests.
const backendOrigins = (() => {
  try {
    return [...new Set([
      process.env.NEXT_PUBLIC_NEON_DATA_API_URL,
      process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
    ].filter(Boolean).map((url) => new URL(url!).origin))];
  } catch {
    return [];
  }
})();

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <head>
        {/* Warm the connections the map and gallery need on first paint: Mapbox
            style/tiles/telemetry, Neon, and R2. preconnect opens the
            TCP+TLS early; dns-prefetch is the cheaper fallback for older browsers. */}
        <link rel="preconnect" href="https://api.mapbox.com" crossOrigin="" />
        <link rel="preconnect" href="https://events.mapbox.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://api.mapbox.com" />
        {backendOrigins.map((origin) => (
          <Fragment key={origin}>
            <link rel="preconnect" href={origin} crossOrigin="" />
            <link rel="dns-prefetch" href={origin} />
          </Fragment>
        ))}
      </head>
      <body>
        {children}
        {/* Vercel page-view analytics and Core Web Vitals reporting. Both are
            no-ops off Vercel, so local dev and the E2E build stay untouched. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
