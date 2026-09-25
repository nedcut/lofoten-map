import { NextResponse } from "next/server";
import { isPreviewReadOnly } from "@/lib/preview-read-only";

const READ_TABLES = new Set([
  "trips", "days", "route_segments", "photos", "notes", "places", "trip_members", "admin_requests",
]);

export async function GET(request: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  if (!isPreviewReadOnly() || !READ_TABLES.has(table)) {
    return new Response(null, { status: 404 });
  }

  const dataApiUrl = process.env.NEXT_PUBLIC_NEON_DATA_API_URL;
  if (!dataApiUrl) {
    return NextResponse.json({ message: "The trip data source is not configured." }, { status: 503 });
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(`${dataApiUrl.replace(/\/$/, "")}/${table}`);
  targetUrl.search = sourceUrl.search;
  const headers = new Headers();
  for (const name of ["authorization", "accept", "accept-profile", "range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstream = await fetch(targetUrl, { headers, cache: "no-store", redirect: "manual" });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "content-range", "range-unit"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ message: "Could not reach the trip data source." }, { status: 502 });
  }
}
