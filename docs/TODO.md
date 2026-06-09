# Todo

Working list for making the app feel pristine without bloating it. Keep this
trimmed: delete items that no longer matter, and prefer small, testable polish
passes over broad rewrites.

## Next Polish Passes

- Smoke-test the deployed app as guest, member, and admin after each schema/auth
  change.
- Re-check mobile flows on a real phone: public viewing, sign-in panel, photo
  import, map placement, and expanded bottom sheet scrolling.
- Add focused tests for the admin request helpers/RPC assumptions where practical.
- Extend EXIF/canvas test coverage around large batches, corrupt files, HEIC
  passthrough, and thumbnail fallback behavior.

## Product Gaps

- Add a friend invite flow for people who have not signed in yet, or at least
  clearer copy around the current "sign in once, then admin adds you" model.
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
