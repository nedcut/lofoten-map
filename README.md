# Lofoten Logbook

An interactive, collaborative trip map and journal. Anyone can view the trip —
filter days, browse route segments, and see notes and photos on the map — with
no account. Signed-in friends auto-join as members so they can drop notes and
photos, request admin access, and see each other's updates live. Photos extract
their GPS/timestamp from EXIF in the browser, fall back to manual placement (or
auto-placement along the day's route) when no geotag exists, and are downscaled
with thumbnails before upload. Admins get in-app editors for the itinerary,
routes, places, photo metadata, and membership.

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
5. Edit `supabase/grant-member.sql` with your email and run it to make your
   first account an admin.
6. Reload — you should see the seeded trip and admin controls.
7. Friends can view the trip without signing in. When they sign in, the app
   auto-joins them as members so they can contribute notes/photos and request
   admin access in-app.

### What the schema sets up

`schema.sql` creates the trip data model (`trips`, `days`, `route_segments`,
`photos`, `notes`, `places`, `trip_members`, `admin_requests`), the
`trip-photos` Storage bucket, member/admin RPCs, Realtime publication for the
collaborative tables, and RLS policies:

- **Reads are public** — `select` is granted to `anon` with `using (true)`, so
  anyone can view the trip without an account.
- **Notes and photos** can be created by any signed-in member; each row is
  updatable and deletable by its owner or a trip admin.
- **Trips, days, routes, places, and membership** are admin-scoped.
- **Admin requests** are visible to the requester and existing admins; admins
  can approve or deny them from the Members panel.

Editing is still account-gated: visitors can view without signing in, signed-in
users auto-join as members, and every insert/update/delete policy requires the
appropriate member/admin role.

### Photo storage

`trip-photos` is a **public** bucket. The `photos` table stores storage *paths*
(`image_path` / `thumbnail_path`), and the app resolves them to plain public URLs
with `getPublicUrl` (`resolvePhotoUrls` in [`lib/supabase.ts`](lib/supabase.ts)) —
a synchronous string build, no signing or expiry, so images load for everyone.

If you are upgrading an existing project, re-run `supabase/schema.sql`: it flips
the bucket to public and (for older databases) migrates the old `image_url` /
`thumbnail_url` columns to `image_path` / `thumbnail_path`.

If the deployed app says Supabase could not find `public.admin_requests` in the
schema cache, your database is behind the app code. Re-run
`supabase/schema.sql` in the Supabase SQL Editor, then refresh the app after
Supabase has reloaded its API schema cache. The trip can still load while that
admin-request feature is unavailable.

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
   for your email to make that first account an admin. Reload.
7. **Smoke test:**
   - Signed-out visitors see the seeded trip (reads are public); the "Sign in"
     button opens the optional sign-in panel.
   - Your admin account shows contribute/admin controls; a guest does not.
   - A newly signed-in friend can contribute notes/photos as a member and can
     request admin access.
   - A note saves and survives reload.
   - A small photo uploads, renders on the map, and survives reload.
   - An admin can approve or deny admin requests and adjust member roles from
     the Members panel.
   - Realtime updates appear in a second browser session.

Before sharing beyond a small test group: add a friend-invitation/notification
flow for people who have not signed in yet, and verify RLS with separate guest,
member, and admin accounts.

## Project structure

```
app/            Next.js App Router entry (single-page map UI in page.tsx)
components/     Map view, layers, sidebar/mobile sheet, upload/note/route panels,
                admin data panel, legend
lib/            access (role/UI access derivation), exif (EXIF parsing),
                photo-processing (downscale + thumbnails), geo (GeoJSON
                helpers), supabase (browser client), utils
                — with co-located *.test.ts suites
supabase/       schema.sql, seed.sql, grant-member.sql
types/          shared trip data types
docs/           work log and todo/roadmap notes
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
- Admin tools: draw route segments, edit trip/day/route/place/photo data,
  manage membership, and review admin-access requests
- Supabase Realtime for photos, notes, places, and route segments
- Row-level security: public reads, member contributions, owner/admin writes
- Public photo storage paths resolved to stable public URLs at read time
- Demo fallback data when Supabase is not configured

## Roadmap

- See [`docs/TODO.md`](docs/TODO.md) for the working todo list.
- See [`docs/WORKLOG.md`](docs/WORKLOG.md) for the ongoing project log.

Current larger next moves:

- Add pending invites or email notifications for friends who have not signed in
  yet
- Extend test coverage to the EXIF File-reading and canvas/thumbnail paths
- Add route import from GPX/KML
- Add offline-friendly drafts for notes and uploads
- Add a Mapbox 3D terrain / flyover scenic mode
- Add comments/reactions and richer day journal entries
