# Work Log

Chronological notes for meaningful project checkpoints. Keep entries short:
what changed, why it mattered, and any verification worth remembering.

## 2026-06-09

- Performance pass after the app started feeling sluggish: the admin panel now
  defers each collapsed section until first opened and paginates the photo
  editor list (collapsed `<details>` still mounted ~1,400 photo forms and
  fetched every thumbnail across the desktop + mobile mounts); photo and
  avatar uploads send image + thumbnail in parallel and set a 1-year
  immutable cache header instead of 1 hour on uuid-named storage files.
- Found 442 byte-identical duplicate photos (60% of the 732-row library,
  ~493 MB) by downloading and hashing every stored image — each duplicate
  group has exactly 4-5 copies, so whole batches were re-uploaded before the
  content-hash guard existed. `scripts/dedupe-photos.mjs` reports in read-only
  mode and, with the service role key, deletes duplicates (keeping the copy
  with a caption, then day assignment, then the oldest) and backfills
  `content_hash` on survivors.
- Hardened upload dedup in a tested `lib/photo-dedup.ts` helper: content-hash
  matching plus a capture-time + GPS fingerprint that survives re-encoding,
  and a fresh database hash re-check before insert so a mid-batch race skips
  the duplicate instead of failing the whole batch on the unique index.
- Added GPX route import (parse, simplify, bucket points by trip day) and member
  avatar profiles: a public `avatars` bucket, an `avatar_path` column on
  `trip_members`, and a self-service `update_my_trip_profile` RPC, all in the
  `add_member_profiles` migration.
- Fixed the Journey Mode caption editor swallowing spaces on mobile: the
  play/pause Space shortcut now also checks `editingCaption` state and
  `document.activeElement`, since `event.target` is unreliable with virtual
  keyboards.
- Generalized the missing-`admin_requests` tolerance into a tested
  `isMissingSchemaObjectError` helper and applied it to the avatar migration:
  if `trip_members.avatar_path` does not exist yet, the roster is refetched
  without it so roles keep working, and profile editing hides until the
  migration is pushed.
- Gitignored `.playwright-mcp/` after rendered-QA debug artifacts slipped into
  a commit.
- Verified the linked Supabase project is fully migrated: `supabase migration
  list --linked` shows all three migrations applied, a dry-run push reports up
  to date, and `trip_members.avatar_path` answers over the public REST API.
- Initialized Supabase CLI project config, added a baseline migration copied
  from the current idempotent schema, and documented linked-project dry-run/push
  commands.
- Made a missing `admin_requests` table/schema-cache error non-fatal during
  deployed Supabase migrations, with admin-request controls hidden until the
  schema is caught up.
- Added a graceful Mapbox/WebGL fallback after rendered QA found headless
  Chromium could crash the whole page when WebGL initialization failed, then
  hid map-dependent quick actions, layer toggles, and map controls when the
  fallback is active.
- Expanded photo-processing tests across the mocked browser canvas path:
  large-image optimization, thumbnail generation, corrupt decode fallback,
  HEIC passthrough, and oversized optimized-output rejection.
- Pulled role/access derivation into a small tested helper so guest, member,
  admin, and admin-request UI states stay consistent as the sharing model evolves.
- Updated Supabase setup/deploy docs for the current access model: public reads,
  signed-in auto-join as member, and in-app admin requests.
- Added this work log and a separate todo list so ongoing polish does not get
  buried in chat history.
- Refreshed README feature/roadmap wording to match the current app: public
  reads, public photo URLs, admin request workflow, and current admin tools.
- Latest verified baseline before this doc pass: `npm run lint`,
  `npm run typecheck`, `npm run test`, and `NEXT_PUBLIC_LOCAL_DEMO_MODE=1 npm run build`.

## Recent Checkpoints

- `23e00e3` - Photo popups no longer render broken empty images when a photo URL
  is missing or not resolved.
- `8f55bf9` - Added in-app admin request workflow for non-admin members.
- `923ff03` - Made the trip publicly viewable while keeping editing gated behind
  sign-in and membership.
- `81804e2` - Simplified photo import by removing the name step and tightening
  placement/upload behavior.
- `b591c9b` / later schema updates - Moved photo rows to storage paths and then
  public URL resolution for reliable guest viewing.
