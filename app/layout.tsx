import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lofoten Logbook",
  description: "A collaborative map and journal for a Lofoten hiking trip.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#e7efe8",
};

// Origin of the Supabase project (storage + realtime). Derived from the public
// env var so a preconnect can warm the TLS handshake before the first photo or
// data request fires.
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
})();

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Warm the connections the map and gallery need on first paint: Mapbox
            style/tiles/telemetry and Supabase storage. preconnect opens the
            TCP+TLS early; dns-prefetch is the cheaper fallback for older browsers. */}
        <link rel="preconnect" href="https://api.mapbox.com" crossOrigin="" />
        <link rel="preconnect" href="https://events.mapbox.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://api.mapbox.com" />
        {supabaseOrigin ? (
          <>
            <link rel="preconnect" href={supabaseOrigin} crossOrigin="" />
            <link rel="dns-prefetch" href={supabaseOrigin} />
          </>
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
