-- Lofoten Logbook MVP schema
-- Development RLS policies below intentionally allow broad anonymous access.
-- Tighten these policies before any public deployment.

create extension if not exists pgcrypto;

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  start_date date,
  end_date date,
  created_at timestamptz default now()
);

create table if not exists days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  day_number int not null,
  date date,
  title text,
  summary text,
  created_at timestamptz default now(),
  unique (trip_id, day_number)
);

create table if not exists route_segments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  day_id uuid references days(id) on delete set null,
  name text,
  source text,
  mode text check (mode in ('hike', 'ferry', 'bus', 'walk', 'other')) default 'hike',
  geometry_geojson jsonb not null,
  distance_meters double precision,
  elevation_gain_meters double precision,
  created_at timestamptz default now()
);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  day_id uuid references days(id) on delete set null,
  uploader_name text,
  image_url text not null,
  thumbnail_url text,
  lat double precision,
  lng double precision,
  taken_at timestamptz,
  caption text,
  exif_found boolean default false,
  created_at timestamptz default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  day_id uuid references days(id) on delete set null,
  author_name text,
  lat double precision not null,
  lng double precision not null,
  body text not null,
  note_type text default 'note',
  created_at timestamptz default now()
);

create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  day_id uuid references days(id) on delete set null,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  place_type text,
  description text,
  created_at timestamptz default now()
);

alter table trips enable row level security;
alter table days enable row level security;
alter table route_segments enable row level security;
alter table photos enable row level security;
alter table notes enable row level security;
alter table places enable row level security;

-- DEV ONLY: anonymous clients can read and write MVP trip data.
-- Replace with authenticated, trip-scoped policies before public launch.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['trips', 'days', 'route_segments', 'photos', 'notes', 'places'] loop
    execute format('drop policy if exists "dev read %1$s" on %1$I', table_name);
    execute format('drop policy if exists "dev insert %1$s" on %1$I', table_name);
    execute format('drop policy if exists "dev update %1$s" on %1$I', table_name);
    execute format('drop policy if exists "dev delete %1$s" on %1$I', table_name);
    execute format('create policy "dev read %1$s" on %1$I for select using (true)', table_name);
    execute format('create policy "dev insert %1$s" on %1$I for insert with check (true)', table_name);
    execute format('create policy "dev update %1$s" on %1$I for update using (true) with check (true)', table_name);
    execute format('create policy "dev delete %1$s" on %1$I for delete using (true)', table_name);
  end loop;
end $$;
