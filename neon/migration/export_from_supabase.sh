#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the Supabase direct database URL}"
command -v psql >/dev/null 2>&1 || {
  echo "psql is required" >&2
  exit 1
}

export_dir="$(mktemp -d "${TMPDIR:-/tmp}/lofoten-neon-export.XXXXXX")"
chmod 700 "$export_dir"

export_csv() {
  local file_name="$1"
  local query="$2"
  psql "$SOURCE_DATABASE_URL" \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --command="\\copy (${query}) to '${export_dir}/${file_name}.csv' with (format csv, header true, null 'NULL')"
}

# Export only auth identities referenced by application rows. The resulting CSV
# contains email addresses and must be treated as sensitive migration material.
export_csv source_users "
  with referenced_users as (
    select user_id from public.photos where user_id is not null
    union select user_id from public.notes where user_id is not null
    union select user_id from public.trip_members
    union select user_id from public.admin_requests where user_id is not null
    union select resolved_by from public.admin_requests where resolved_by is not null
  )
  select users.id::text as supabase_user_id,
         lower(users.email) as email,
         users.email_confirmed_at is not null as email_verified
  from auth.users as users
  join referenced_users on referenced_users.user_id = users.id
  order by users.id
"

export_csv trips "
  select id, title, slug, description, start_date, end_date, created_at
  from public.trips order by id
"
export_csv days "
  select id, trip_id, day_number, date, title, summary, created_at
  from public.days order by id
"
export_csv route_segments "
  select id, trip_id, day_id, name, source, mode, geometry_geojson,
         distance_meters, elevation_gain_meters, created_at
  from public.route_segments order by id
"
export_csv photos "
  select id, trip_id, day_id, user_id::text as supabase_user_id,
         uploader_name, content_hash, media_type, image_path, thumbnail_path,
         lat, lng, taken_at, caption, exif_found, created_at
  from public.photos order by id
"
export_csv notes "
  select id, trip_id, day_id, user_id::text as supabase_user_id,
         author_name, lat, lng, body, note_type, created_at
  from public.notes order by id
"
export_csv places "
  select id, trip_id, day_id, name, lat, lng, place_type, description, created_at
  from public.places order by id
"
export_csv trip_members "
  select trip_id, user_id::text as supabase_user_id, role, display_name,
         avatar_path, created_at
  from public.trip_members order by trip_id, user_id
"
export_csv admin_requests "
  select id, trip_id, user_id::text as supabase_user_id, display_name, email,
         note, status, created_at, resolved_at,
         resolved_by::text as resolved_by_supabase_user_id
  from public.admin_requests order by id
"

psql "$SOURCE_DATABASE_URL" \
  --no-psqlrc \
  --set=ON_ERROR_STOP=1 \
  --tuples-only \
  --no-align \
  --field-separator=, \
  --command="
    select 'table_name,row_count'
    union all select 'trips,' || count(*) from public.trips
    union all select 'days,' || count(*) from public.days
    union all select 'route_segments,' || count(*) from public.route_segments
    union all select 'photos,' || count(*) from public.photos
    union all select 'notes,' || count(*) from public.notes
    union all select 'places,' || count(*) from public.places
    union all select 'trip_members,' || count(*) from public.trip_members
    union all select 'admin_requests,' || count(*) from public.admin_requests;
  " >"$export_dir/source_counts.csv"

echo "Export complete: $export_dir"
echo "This directory contains user emails. Keep it private and delete it after verification."
