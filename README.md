# Lofoten Logbook

A polished MVP for an interactive collaborative Lofoten trip map and journal. Friends can filter trip days, view route GeoJSON, add notes, upload photos, extract EXIF GPS metadata client-side, manually place missing geotags, and receive live Supabase updates.

## Stack

- Next.js App Router with TypeScript
- Tailwind CSS
- Mapbox GL JS
- Supabase Postgres, Storage, Auth, trip membership roles, and Realtime
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

Never expose a Supabase service role key in the browser or in Vercel public environment variables.

## Supabase setup

Keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` empty to stay in local demo mode. When you are ready for shared Supabase mode:

1. Create a Supabase project.
2. In Authentication settings, enable email magic links/OTP.
3. In SQL Editor, run `supabase/schema.sql`.
4. In SQL Editor, run `supabase/seed.sql`.
5. Put your project URL and anon key in `.env.local`, then start the app and sign in once with your email.
6. In SQL Editor, edit and run `supabase/grant-member.sql` to add that email to `trip_members` as an admin.
7. Reload the app. You should see the seeded trip while signed in as that member.
8. Admin users can add friends from the Members panel after those friends have signed in once.

`schema.sql` creates the `trip-photos` Storage bucket, grants authenticated API access, enables Realtime for collaborative tables, adds an admin-only member grant RPC, and applies RLS policies. Trip data is readable only by authenticated users in `trip_members`. Notes and photos can be created by trip members; route, day, place, and membership edits are admin-scoped.

Never expose a Supabase service role key in the browser. The client app only needs the public URL and anon key.

For the current testing build, `trip-photos` is configured as a public bucket so uploaded image URLs render directly in Mapbox popups. Treat uploaded test photos as shareable-by-URL until the app moves to private buckets with signed image URLs.

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

This app is ready for a test deployment once Mapbox and Supabase are configured.

1. Push the repository to GitHub.
2. Import it in Vercel.
3. Add these environment variables in Vercel Project Settings:

```bash
NEXT_PUBLIC_MAPBOX_TOKEN=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_TRIP_SLUG=lofoten-2026
```

4. In Supabase, add the deployed URL to Authentication > URL Configuration:
   - Site URL: `https://your-vercel-app.vercel.app`
   - Redirect URLs: `https://your-vercel-app.vercel.app/**`
   - Keep `http://localhost:3000/**` while testing locally.
5. Run `supabase/schema.sql`, then `supabase/seed.sql`.
6. Sign in once from the deployed app with your email.
7. Edit `supabase/grant-member.sql`, run it for that email, then reload the deployed app.
8. Smoke test:
   - Signed-out visitors see the sign-in panel in Supabase mode.
   - Your member account can load the seeded trip.
   - A non-member account cannot load trip data.
   - Notes save and appear after reload.
   - A small test photo uploads, renders on the map, and appears after reload.
   - An admin can add a signed-in friend from the Members panel.
   - Realtime updates appear in another browser session.

Before sharing beyond a small test group, tighten photo privacy, add a member invitation/admin flow, and test RLS with separate member and non-member users.

## Next-step roadmap

- Deploy a test Vercel build and verify Supabase auth redirects, RLS, Storage uploads, and Realtime.
- Move photo Storage from public URLs to private signed URLs before wider sharing.
- Expand member management with pending invites or email notifications.
- Generate thumbnails and optionally compress large photos before upload.
- Add route import from GPX/KML.
- Add offline-friendly drafts for notes and uploads.
- Add Mapbox 3D terrain/flyover scenic mode.
- Add comments/reactions and richer day journal entries.
