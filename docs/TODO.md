# Todo

Working list for making the app feel pristine without bloating it. Keep this
trimmed: delete items that no longer matter, and prefer small, testable polish
passes over broad rewrites.

## Next Polish Passes

- Smoke-test the deployed app as guest, member, and admin after each schema/auth
  change.
- Re-check mobile flows on a real phone: public viewing, sign-in panel, photo
  import, map placement, and expanded bottom sheet scrolling.
- Extend EXIF coverage around large batches and edge-case camera metadata.
- Add real-browser or integration coverage for photo upload placement once a
  browser test harness is in place; unit coverage now exercises canvas resize,
  corrupt-file fallback, HEIC passthrough, and thumbnail generation.
- Verify the auto-join + admin-request flow against a real Supabase project as:
  guest, newly signed-in member, existing admin, and demoted member.
- Add a thin integration smoke test around the admin-request RPCs once a test
  Supabase project or local Supabase test harness is in place.

## Product Gaps

- Add a friend invite/notification flow for people who have not signed in yet,
  building on the current auto-join + admin-request model.
- Add GPX/KML route import when the real route file arrives.
- Add offline-friendly drafts for notes/photos so weak connectivity does not
  lose work mid-trip.
- Add richer day journal entries only if the core map/photo/note workflow stays
  simple.

## Later Ideas

- Mapbox 3D terrain / scenic flyover mode.
- Lightweight comments/reactions on photos or day entries.
- Optional private-photo mode if the sharing posture changes away from public
  viewing.
