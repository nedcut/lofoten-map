# Neon database migration

This directory is the database half of the Supabase-to-Neon/R2 migration. It
preserves the eight application tables, constraints, RLS rules, and RPC behavior
from `supabase/schema.sql`, with these deliberate platform translations:

- `auth.users` becomes Neon Auth's `neon_auth."user"`.
- `auth.uid()` becomes the Neon Data API's `auth.user_id()`.
- Supabase's `anon` role becomes Neon's `anonymous` role.
- Application user IDs remain UUIDs, matching this project's managed
  `neon_auth."user".id`. The Data API's `auth.user_id()` returns text, so every
  database comparison, default, or insert converts it with
  `nullif(auth.user_id(), '')::uuid`. All other entity IDs also remain UUIDs.
- Storage buckets/policies and the `supabase_realtime` publication are omitted.
  `image_path`, `thumbnail_path`, and `avatar_path` remain object-key strings for
  the R2 layer.

The schema also exposes two narrowly scoped authenticated RPCs for the server:

- `current_user_id()` intentionally returns the raw Neon Auth subject as text
  for API-route compatibility.
- `is_my_avatar_path(path)` allows an exact match against one of the caller's
  stored legacy avatar paths. It exists so old avatar keys containing Supabase
  UUIDs remain readable after identity remapping.

Every `SECURITY DEFINER` function uses an empty search path. `PUBLIC` and
`anonymous` execute privileges are explicitly revoked before execute is granted
to `authenticated`.

## Prerequisites

1. Create a Neon project and a non-production migration branch.
2. Enable **Neon Auth** on that branch. This provisions `neon_auth."user"`.
3. Enable the **Neon Data API** on that branch. This provisions the
   `authenticated` and `anonymous` roles and `auth.user_id()`.
4. Install a PostgreSQL client that supplies `psql`.
5. Use direct (non-pooler) database URLs for DDL and migration work, with TLS
   required.

The current Neon model is documented at:

- <https://neon.com/docs/guides/row-level-security>
- <https://neon.com/blog/neon-auth-branchable-identity-in-your-database>

## 1. Install the target schema

`schema.sql` is intentionally a fresh-database schema. It fails if Neon Auth or
Data API prerequisites are missing, and it fails if any application table
already exists.

```bash
export TARGET_DATABASE_URL='postgresql://...?...sslmode=require'
psql "$TARGET_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --file=neon/schema.sql
```

Do not point this at the Supabase database.

## 2. Have existing users authenticate with Neon

Supabase password hashes and sessions are not copied. Each existing member must
create or sign into the corresponding Neon Auth account using the same verified
email address. Finish this before applying the data import.

The migration never guesses identity from display names. It normalizes verified
email addresses with `lower(...)`, rejects duplicate normalized emails on either
side, requires both Supabase and Neon Auth to mark the email verified, and aborts
if any referenced Supabase identity lacks a Neon match.

## 3. Export a consistent Supabase snapshot

Use a short application write freeze for the final export. The exporter is
read-only and writes CSV files to a new mode-`0700` temporary directory. The
directory contains user email addresses and must be protected.

```bash
export SOURCE_DATABASE_URL='postgresql://...supabase...?...sslmode=require'
bash neon/migration/export_from_supabase.sh
```

Record the printed directory path and inspect `source_counts.csv`.

## 4. Stage, remap, load, and verify

The loader resets only the target's disposable `migration` schema. The final
application-table load is one transaction and refuses to run if any target app
table is non-empty. Old Supabase UUIDs are retained as text in the staging
tables and in `migration.user_map`; ownership columns are changed to matched
Neon Auth UUIDs during the atomic insert.

```bash
export TARGET_DATABASE_URL='postgresql://...neon...?...sslmode=require'
export MIGRATION_EXPORT_DIR='/private/tmp/lofoten-neon-export.XXXXXX'
bash neon/migration/load_into_neon.sh
```

`03_verify.sql` checks all eight row counts, auth references, the at-least-one-
admin invariant for every trip, and `PUBLIC` execute exposure on all public
`SECURITY DEFINER` functions. It prints the source-to-Neon user map for manual
email review.

If verification fails, the application inserts roll back. Fix the staging or
Neon Auth account issue, rerun `01_prepare_staging.sql` via the loader, and try
again. Do not edit production rows to force a match.

## 5. Cutover and rollback discipline

- Complete the R2 object copy and application verification before changing
  production environment variables.
- Run a final write-frozen export/load if the rehearsal snapshot is stale.
- Keep Supabase unchanged and read-only during the rollback window.
- Compare `source_counts.csv` to the verifier output and exercise anonymous
  reads, member inserts/updates/deletes, admin RPCs, and legacy avatar reads.
- After the rollback window, delete the temporary CSV directory and remove the
  target's staging copy because both contain personal data:

  ```bash
  psql "$TARGET_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 \
    --file=neon/migration/04_cleanup_staging.sql
  ```

The migration scripts do not delete or modify the source Supabase project.
