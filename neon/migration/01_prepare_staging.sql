-- Run on the target Neon branch before loading exported CSV files.
-- Re-running is safe: only the disposable migration staging schema is reset.

begin;

drop schema if exists migration cascade;
create schema migration;

create table migration.source_users (
  supabase_user_id text primary key,
  email text not null,
  email_verified boolean not null
);

create table migration.trips (
  id uuid,
  title text,
  slug text,
  description text,
  start_date date,
  end_date date,
  created_at timestamptz
);

create table migration.days (
  id uuid,
  trip_id uuid,
  day_number int,
  date date,
  title text,
  summary text,
  created_at timestamptz
);

create table migration.route_segments (
  id uuid,
  trip_id uuid,
  day_id uuid,
  name text,
  source text,
  mode text,
  geometry_geojson jsonb,
  distance_meters double precision,
  elevation_gain_meters double precision,
  created_at timestamptz
);

create table migration.photos (
  id uuid,
  trip_id uuid,
  day_id uuid,
  supabase_user_id text,
  uploader_name text,
  content_hash text,
  media_type text,
  image_path text,
  thumbnail_path text,
  lat double precision,
  lng double precision,
  taken_at timestamptz,
  caption text,
  exif_found boolean,
  created_at timestamptz
);

create table migration.notes (
  id uuid,
  trip_id uuid,
  day_id uuid,
  supabase_user_id text,
  author_name text,
  lat double precision,
  lng double precision,
  body text,
  note_type text,
  created_at timestamptz
);

create table migration.places (
  id uuid,
  trip_id uuid,
  day_id uuid,
  name text,
  lat double precision,
  lng double precision,
  place_type text,
  description text,
  created_at timestamptz
);

create table migration.trip_members (
  trip_id uuid,
  supabase_user_id text,
  role text,
  display_name text,
  avatar_path text,
  created_at timestamptz
);

create table migration.admin_requests (
  id uuid,
  trip_id uuid,
  supabase_user_id text,
  display_name text,
  email text,
  note text,
  status text,
  created_at timestamptz,
  resolved_at timestamptz,
  resolved_by_supabase_user_id text
);

commit;
