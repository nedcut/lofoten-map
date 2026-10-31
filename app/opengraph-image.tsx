import { ImageResponse } from "next/og";
import { loadGoogleFont, loadOgTrip, projectRoutes } from "@/lib/og-trip";

export const alt = "Lofoten Logbook — a shared journey through Norway";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Rebuilt daily, so new photos and routes reach link previews without a deploy.
export const revalidate = 86400;

const ROUTE_BOX = { width: 330, height: 300 };

// The card most people see first, in a chat or a feed: one of the trip's own
// landscapes, the title in the display serif, and the trip's route traced in
// its day colours like a signature. Without a backend (demo builds, CI) it
// falls back to the plain gradient card.
export default async function Image() {
  const trip = await loadOgTrip(process.env.NEXT_PUBLIC_TRIP_SLUG ?? "lofoten-2026");
  if (!trip) return fallbackCard();

  const overline = "A shared travel story";
  // The trace is the trip on foot: a long ferry from the mainland would
  // otherwise stretch the box and squash the islands' trails to a line.
  const routes = projectRoutes(trip.routes.filter((route) => route.onFoot), ROUTE_BOX.width, ROUTE_BOX.height);
  const stats = [
    trip.dayCount ? `${trip.dayCount} days` : null,
    trip.photoCount ? `${trip.photoCount} photos` : null,
    trip.onFootKm ? `${trip.onFootKm} km on foot` : null,
  ].filter(Boolean).join("  ·  ");
  const [display, body] = await Promise.all([
    loadGoogleFont("Fraunces", "opsz,wght@144,600", trip.title),
    loadGoogleFont("Inter", "wght@500", `${overline.toUpperCase()}${trip.description ?? ""}${stats}`),
  ]);
  const fonts = [
    ...(body ? [{ name: "Inter", data: body, weight: 500 as const, style: "normal" as const }] : []),
    ...(display ? [{ name: "Fraunces", data: display, weight: 600 as const, style: "normal" as const }] : []),
  ];
  // satori doesn't read the inset shorthand.
  const fill = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex" } as const;

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#102f29", color: "#fffdf6", fontFamily: body ? "Inter" : undefined }}>
      {trip.coverUrl ? (
        <img src={trip.coverUrl} alt="" width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, width: 1200, height: 630, objectFit: "cover" }} />
      ) : null}
      <div style={{ ...fill, backgroundImage: "linear-gradient(90deg, rgba(12,10,9,0.78) 0%, rgba(12,10,9,0.5) 42%, rgba(12,10,9,0.05) 75%)" }} />
      <div style={{ ...fill, top: 330, backgroundImage: "linear-gradient(0deg, rgba(12,10,9,0.75), rgba(12,10,9,0))" }} />

      {routes.length > 0 ? (
        <div style={{ position: "absolute", right: 44, bottom: 44, width: ROUTE_BOX.width + 40, height: ROUTE_BOX.height + 40, display: "flex", borderRadius: 32, backgroundColor: "rgba(12,10,9,0.58)", border: "1px solid rgba(255,253,246,0.18)" }} />
      ) : null}
      {routes.length > 0 ? (
        <svg width={ROUTE_BOX.width} height={ROUTE_BOX.height} viewBox={`0 0 ${ROUTE_BOX.width} ${ROUTE_BOX.height}`} style={{ position: "absolute", right: 64, bottom: 64 }}>
          {routes.map((route, index) => (
            <polyline key={`glow-${index}`} points={route.points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" stroke="rgba(255,253,246,0.7)" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {routes.map((route, index) => (
            <polyline key={`line-${index}`} points={route.points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" stroke={route.color} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
      ) : null}

      <div style={{ position: "absolute", left: 76, top: 0, bottom: 0, width: 640, display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: 76 }}>
        <div style={{ fontSize: 22, letterSpacing: 6, color: "#f0ae4b" }}>{overline.toUpperCase()}</div>
        <div style={{ marginTop: 18, fontSize: 104, lineHeight: 0.95, fontWeight: 600, fontFamily: display ? "Fraunces" : undefined, letterSpacing: -2 }}>{trip.title}</div>
        {trip.description ? <div style={{ marginTop: 22, fontSize: 32, color: "rgba(255,253,246,0.85)" }}>{trip.description}</div> : null}
        {stats ? <div style={{ marginTop: 16, fontSize: 24, color: "rgba(255,253,246,0.65)" }}>{stats}</div> : null}
      </div>
    </div>,
    { ...size, fonts: fonts.length > 0 ? fonts : undefined },
  );
}

function fallbackCard() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 76, color: "#fffdf6", background: "linear-gradient(145deg, #102f29 0%, #275c50 55%, #d28b32 140%)" }}>
      <div style={{ fontSize: 24, letterSpacing: 7, textTransform: "uppercase", color: "#ffd089" }}>A shared travel story</div>
      <div style={{ marginTop: 22, fontSize: 88, fontWeight: 700 }}>Lofoten Logbook</div>
      <div style={{ marginTop: 18, fontSize: 34, color: "rgba(255,253,246,.78)" }}>Relive the journey through Norway’s wild north.</div>
    </div>,
    size,
  );
}
