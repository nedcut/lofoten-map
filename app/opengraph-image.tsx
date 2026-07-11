import { ImageResponse } from "next/og";

export const alt = "Lofoten Logbook — a shared journey through Norway";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 76, color: "#fffdf6", background: "linear-gradient(145deg, #102f29 0%, #275c50 55%, #d28b32 140%)" }}>
      <div style={{ fontSize: 24, letterSpacing: 7, textTransform: "uppercase", color: "#ffd089" }}>A shared travel story</div>
      <div style={{ marginTop: 22, fontSize: 88, fontWeight: 700 }}>Lofoten Logbook</div>
      <div style={{ marginTop: 18, fontSize: 34, color: "rgba(255,253,246,.78)" }}>Relive the journey through Norway’s wild north.</div>
    </div>,
    size,
  );
}
