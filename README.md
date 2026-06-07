# Lofoten Logbook

A polished MVP for an interactive collaborative Lofoten trip map and journal. Friends can filter trip days, view route GeoJSON, add notes, upload photos, extract EXIF GPS metadata client-side, manually place missing geotags, and receive live Supabase updates.

## Stack

- Next.js App Router with TypeScript
- Tailwind CSS
- Mapbox GL JS
- Supabase Postgres, Storage, Auth scaffolding, and Realtime
- Turf.js for GeoJSON route utilities
- ExifReader for client-side photo metadata parsing

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

The app runs in local demo mode if Supabase variables are missing. A Mapbox token is required for the live map tiles.

## Environment variables

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_TRIP_SLUG=lofoten-2026
```

Never expose a Supabase service role key in the browser.

## Supabase setup

1. Create a Supabase project.
2. In SQL Editor, run `supabase/schema.sql`.
3. In SQL Editor, run `supabase/seed.sql`.
4. Create a public Storage bucket named `trip-photos`.
5. Enable Realtime for the `photos`, `notes`, `places`, and `route_segments` tables from Supabase's Replication/Realtimes settings.
6. Put your project URL and anon key in `.env.local`.

The included RLS policies are for development only and allow broad anonymous reads/writes. Tighten them before deploying publicly.

## Mapbox setup

Create a Mapbox access token and set `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env.local`. The MVP uses the `outdoors-v12` style centered around Reine/Lofoten. The map is structured so a future 3D terrain toggle can add a raster DEM source and call `setTerrain` without replacing the app architecture.

## Features included

- Full-screen responsive map layout
- Desktop sidebar and mobile bottom sheet controls
- Placeholder trip days and day filtering
- GeoJSON route rendering
- Photo, note, and place marker layers with popups
- Add-note flow using map clicks/taps for location
- Upload-photo flow with image validation, EXIF GPS/timestamp extraction, manual map placement fallback, Supabase Storage upload, and Postgres metadata insert
- Supabase Realtime subscriptions for photos, notes, places, and route segments
- Demo fallback data when Supabase is not configured

## Useful commands

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

## Deploying to Vercel

1. Push the repository to GitHub.
2. Import it in Vercel.
3. Add the same public environment variables in Vercel Project Settings.
4. Verify Supabase Storage bucket policies and table RLS policies are production-ready before sharing publicly.

## Next-step roadmap

- Add real Supabase Auth and trip membership roles.
- Generate thumbnails on upload.
- Add route import from GPX/KML.
- Add offline-friendly drafts for notes and uploads.
- Add Mapbox 3D terrain/flyover scenic mode.
- Add comments/reactions and richer day journal entries.
