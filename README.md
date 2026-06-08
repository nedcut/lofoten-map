# Lofoten Logbook

An interactive, collaborative trip map and journal. Trip members filter days,
browse route segments, drop notes and photos on the map, and see each other's
updates live. Photos extract their GPS/timestamp from EXIF in the browser, fall
back to manual placement (or auto-placement along the day's route) when no
geotag exists, and are downscaled with thumbnails before upload. Admins get
in-app editors for the itinerary, routes, places, photo metadata, and
membership.

It runs in two modes:

- **Demo mode** — zero config. With no Supabase keys set, the app loads bundled
  sample data so you can explore the UI immediately. (A Mapbox token is still
  needed for map tiles.)
- **Supabase mode** — set the Supabase URL + anon key and the app becomes a
  real multi-user app backed by Postgres, Storage, Auth, row-level security,
  and Realtime.

## Quick start

```bash
npm install
cp .env.example .env.local   # add at least NEXT_PUBLIC_MAPBOX_TOKEN
npm run dev                  # http://localhost:3000
```

Leave the Supabase variables blank to stay in demo mode. To force demo mode even
when Supabase keys are present, set `NEXT_PUBLIC_LOCAL_DEMO_MODE=1` — it only
takes effect on `localhost`/`127.0.0.1` and is ignored everywhere else.

## Stack

- **Next.js** (App Router) + **TypeScript**
- **Tailwind CSS**
- **Mapbox GL JS** — `outdoors-v12` style centered on Reine/Lofoten
- **Supabase** — Postgres, Storage, Auth, membership roles, RLS, Realtime
- **Turf.js** — GeoJSON route/distance utilities
- **ExifReader** — client-side photo metadata parsing
- **Vitest** + **GitHub Actions** — unit tests and CI

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | Mapbox access token for map tiles |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase mode | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase mode | Supabase public anon key |
| `NEXT_PUBLIC_TRIP_SLUG` | Yes | Which trip to load (default `lofoten-2026`) |
| `NEXT_PUBLIC_LOCAL_DEMO_MODE` | No | Set to `1` to force demo mode on localhost |

All variables are `NEXT_PUBLIC_*` and shipped to the browser. **Never** put a
Supabase service role key here or in Vercel — the client only needs the public
URL and anon key.

## Mapbox setup

Create a Mapbox access token and set `NEXT_PUBLIC_MAPBOX_TOKEN`. The map is
structured so a future 3D terrain toggle can add a raster DEM source and call
`setTerrain` without reworking the architecture.

## Supabase setup

Keep the Supabase variables empty to stay in demo mode. To enable shared mode:

1. Create a Supabase project.
2. In **Authentication**, enable email magic links / OTP.
3. In the **SQL Editor**, run `supabase/schema.sql`, then `supabase/seed.sql`.
4. Put the project URL and anon key in `.env.local`, start the app, and sign in
   once with your email.
5. Edit `supabase/grant-member.sql` with your email and run it to add yourself
   to `trip_members` as an admin.
6. Reload — you should see the seeded trip as a signed-in member.
7. Admins can add friends from the Members panel after each friend has signed in
   once.

### What the schema sets up

`schema.sql` creates the trip data model (`trips`, `days`, `route_segments`,
`photos`, `notes`, `places`, `trip_members`), the `trip-photos` Storage bucket,
an admin-only member-grant RPC, Realtime publication for the collaborative
tables, and RLS policies:

- **Reads** are restricted to authenticated users who are in `trip_members`.
- **Notes and photos** can be created by any member; each row is updatable and
  deletable by its owner or a trip admin.
- **Trips, days, routes, places, and membership** are admin-scoped.

### Photo storage privacy

`trip-photos` is a **private** bucket. The `photos` table stores storage *paths*
(`image_path` / `thumbnail_path`), and the app mints short-lived **signed URLs**
(8-hour expiry) at read time to render images. Signing is authorized by the
member-scoped SELECT policy on `storage.objects`, so only authenticated trip
members can load photos, and any leaked URL stops working when it expires.

The signed-URL lifetime is a single constant — `PHOTO_SIGNED_URL_TTL_SECONDS` in
[`lib/supabase.ts`](lib/supabase.ts). Nothing that expires is persisted, so it
can be changed freely. URLs are regenerated on every load (mount, Realtime
update, and after each mutation); a tab left idle past the TTL needs a refresh.

If you are upgrading an existing project, re-run `supabase/schema.sql`: it flips
the bucket to private and migrates the old `image_url` / `thumbnail_url` columns
to `image_path` / `thumbnail_path`, converting any stored public URLs to paths.

## Deploying to Vercel

The app deploys as a standard Next.js project — Vercel runs `next build`
automatically. Your CI also validates a production build on every PR.

1. **Push to GitHub** (already done if you cloned this repo).
2. **Import the repo in Vercel** (New Project → import).
3. **Add environment variables** in Project Settings → Environment Variables:

   ```bash
   NEXT_PUBLIC_MAPBOX_TOKEN=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   NEXT_PUBLIC_TRIP_SLUG=lofoten-2026
   ```

   (Omit the Supabase pair to deploy a public demo-mode build.)
4. **Point Supabase Auth at the deployment** under Authentication → URL
   Configuration:
   - Site URL: `https://your-app.vercel.app`
   - Redirect URLs: `https://your-app.vercel.app/**` (keep
     `http://localhost:3000/**` while developing locally)
5. **Run the SQL** if you haven't: `supabase/schema.sql`, then
   `supabase/seed.sql`.
6. **Sign in once** from the deployed app, then run `supabase/grant-member.sql`
   for your email and reload.
7. **Smoke test:**
   - Signed-out visitors see the sign-in panel (Supabase mode).
   - Your member account loads the seeded trip; a non-member cannot.
   - A note saves and survives reload.
   - A small photo uploads, renders on the map, and survives reload.
   - An admin can add a signed-in friend from the Members panel.
   - Realtime updates appear in a second browser session.

Before sharing beyond a small test group: add a proper member-invitation flow,
and verify RLS with separate member and non-member accounts.

## Project structure

```
app/            Next.js App Router entry (single-page map UI in page.tsx)
components/     Map view, layers, sidebar/mobile sheet, upload/note/route panels,
                admin data panel, legend
lib/            exif (EXIF parsing), photo-processing (downscale + thumbnails),
                geo (GeoJSON helpers), supabase (browser client), utils
                — with co-located *.test.ts suites
supabase/       schema.sql, seed.sql, grant-member.sql
types/          shared trip data types
```

## Development

```bash
npm run dev            # local dev server
npm run lint           # ESLint
npm run typecheck      # next typegen + tsc --noEmit
npm run test           # Vitest unit suite (one-off)
npm run test:watch     # Vitest in watch mode
npm run test:coverage  # unit suite with a coverage report
npm run build          # production build
npm run ci             # lint + typecheck + test (mirrors CI)
```

Unit tests live next to the code they cover (`lib/*.test.ts`) and run under
[Vitest](https://vitest.dev). GitHub Actions runs `lint`, `typecheck`, `test`,
and a demo-mode `build` on every push and pull request to `main`
(see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Features

- Full-screen responsive map with a desktop sidebar and a mobile bottom sheet
- Trip-day filtering over a seeded itinerary, with admin-editable day details
- Route segments (ferry / bus / other modes) rendered and styled from GeoJSON
- Photo, note, and place marker layers with popups and a map legend
- Add-note flow that uses a map click/tap for location
- Photo upload pipeline:
  - bulk queue with per-photo review and day assignment
  - client-side EXIF GPS + timestamp extraction
  - image downscaling and thumbnail generation before upload
  - manual map placement, or automatic placement along the day's route, when no
    geotag is present
  - retryable failures and storage cleanup when a database insert fails
- Admin tools: draw/import route segments, edit trip/day/route/place/photo data,
  and manage membership (admin-only grant RPC)
- Supabase Realtime for photos, notes, places, and route segments
- Row-level security: member-scoped reads, owner/admin writes
- Private photo storage served via short-lived (8h) signed URLs
- Demo fallback data when Supabase is not configured

## Roadmap

- Expand member management with pending invites or email notifications
- Extend test coverage to the EXIF File-reading and canvas/thumbnail paths
- Add route import from GPX/KML
- Add offline-friendly drafts for notes and uploads
- Add a Mapbox 3D terrain / flyover scenic mode
- Add comments/reactions and richer day journal entries
