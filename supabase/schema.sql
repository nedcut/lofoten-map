-- Lofoten Logbook MVP schema
-- Authenticated Supabase mode is private to trip members. Run seed.sql after
-- this schema, then add at least one auth user to trip_members from SQL.

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
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
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
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
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

create table if not exists trip_members (
  trip_id uuid references trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  display_name text,
  created_at timestamptz default now(),
  primary key (trip_id, user_id)
);

alter table photos add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
alter table notes add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();

create or replace function public.is_trip_member(check_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = check_trip_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_trip_admin(check_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = check_trip_id
      and user_id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.is_trip_member_by_slug(check_trip_slug text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.trips
    join public.trip_members on trip_members.trip_id = trips.id
    where trips.slug = check_trip_slug
      and trip_members.user_id = auth.uid()
  );
$$;

grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.is_trip_admin(uuid) to authenticated;
grant execute on function public.is_trip_member_by_slug(text) to authenticated;

create or replace function public.grant_trip_member_by_email(target_trip_slug text, target_email text, target_role text default 'member')
returns table (
  trip_id uuid,
  user_id uuid,
  role text,
  display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  found_trip_id uuid;
  found_user_id uuid;
  found_display_name text;
  normalized_email text;
begin
  normalized_email := lower(trim(target_email));

  if normalized_email = '' then
    raise exception 'Email is required';
  end if;

  if target_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member';
  end if;

  select id into found_trip_id
  from public.trips
  where slug = target_trip_slug;

  if found_trip_id is null then
    raise exception 'Trip not found';
  end if;

  if not public.is_trip_admin(found_trip_id) then
    raise exception 'Only trip admins can add members' using errcode = '42501';
  end if;

  select id, coalesce(raw_user_meta_data ->> 'full_name', email)
  into found_user_id, found_display_name
  from auth.users
  where lower(email) = normalized_email
  limit 1;

  if found_user_id is null then
    raise exception 'No signed-in user found for %', normalized_email;
  end if;

  insert into public.trip_members (trip_id, user_id, role, display_name)
  values (found_trip_id, found_user_id, target_role, found_display_name)
  on conflict (trip_id, user_id) do update
    set role = excluded.role,
        display_name = coalesce(excluded.display_name, public.trip_members.display_name)
  returning public.trip_members.trip_id, public.trip_members.user_id, public.trip_members.role, public.trip_members.display_name, public.trip_members.created_at
  into grant_trip_member_by_email.trip_id, grant_trip_member_by_email.user_id, grant_trip_member_by_email.role, grant_trip_member_by_email.display_name, grant_trip_member_by_email.created_at;

  return next;
end;
$$;

grant execute on function public.grant_trip_member_by_email(text, text, text) to authenticated;

grant usage on schema public to anon, authenticated;
grant all on table trips, days, route_segments, photos, notes, places, trip_members to authenticated;
grant usage on all sequences in schema public to authenticated;

alter table trips enable row level security;
alter table days enable row level security;
alter table route_segments enable row level security;
alter table photos enable row level security;
alter table notes enable row level security;
alter table places enable row level security;
alter table trip_members enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['trips', 'days', 'route_segments', 'photos', 'notes', 'places', 'trip_members'] loop
    execute format('drop policy if exists "dev read %1$s" on %1$I', table_name);
    execute format('drop policy if exists "dev insert %1$s" on %1$I', table_name);
    execute format('drop policy if exists "dev update %1$s" on %1$I', table_name);
    execute format('drop policy if exists "dev delete %1$s" on %1$I', table_name);
  end loop;
end $$;

drop policy if exists "members read trips" on trips;
drop policy if exists "admins write trips" on trips;
create policy "members read trips" on trips for select to authenticated using (public.is_trip_member(id));
create policy "admins write trips" on trips for all to authenticated using (public.is_trip_admin(id)) with check (public.is_trip_admin(id));

drop policy if exists "members read days" on days;
drop policy if exists "admins write days" on days;
create policy "members read days" on days for select to authenticated using (public.is_trip_member(trip_id));
create policy "admins write days" on days for all to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

drop policy if exists "members read route segments" on route_segments;
drop policy if exists "admins write route segments" on route_segments;
create policy "members read route segments" on route_segments for select to authenticated using (public.is_trip_member(trip_id));
create policy "admins write route segments" on route_segments for all to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

drop policy if exists "members read places" on places;
drop policy if exists "admins write places" on places;
create policy "members read places" on places for select to authenticated using (public.is_trip_member(trip_id));
create policy "admins write places" on places for all to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

drop policy if exists "members read photos" on photos;
drop policy if exists "members insert own photos" on photos;
drop policy if exists "owners or admins update photos" on photos;
drop policy if exists "owners or admins delete photos" on photos;
create policy "members read photos" on photos for select to authenticated using (public.is_trip_member(trip_id));
create policy "members insert own photos" on photos for insert to authenticated with check (public.is_trip_member(trip_id) and user_id = auth.uid());
create policy "owners or admins update photos" on photos for update to authenticated using (user_id = auth.uid() or public.is_trip_admin(trip_id)) with check (user_id = auth.uid() or public.is_trip_admin(trip_id));
create policy "owners or admins delete photos" on photos for delete to authenticated using (user_id = auth.uid() or public.is_trip_admin(trip_id));

drop policy if exists "members read notes" on notes;
drop policy if exists "members insert own notes" on notes;
drop policy if exists "owners or admins update notes" on notes;
drop policy if exists "owners or admins delete notes" on notes;
create policy "members read notes" on notes for select to authenticated using (public.is_trip_member(trip_id));
create policy "members insert own notes" on notes for insert to authenticated with check (public.is_trip_member(trip_id) and user_id = auth.uid());
create policy "owners or admins update notes" on notes for update to authenticated using (user_id = auth.uid() or public.is_trip_admin(trip_id)) with check (user_id = auth.uid() or public.is_trip_admin(trip_id));
create policy "owners or admins delete notes" on notes for delete to authenticated using (user_id = auth.uid() or public.is_trip_admin(trip_id));

drop policy if exists "members read trip memberships" on trip_members;
drop policy if exists "admins write trip memberships" on trip_members;
create policy "members read trip memberships" on trip_members for select to authenticated using (public.is_trip_member(trip_id));
create policy "admins write trip memberships" on trip_members for all to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

insert into storage.buckets (id, name, public)
values ('trip-photos', 'trip-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "trip members read photo objects" on storage.objects;
drop policy if exists "trip members upload photo objects" on storage.objects;
drop policy if exists "trip members update photo objects" on storage.objects;
drop policy if exists "trip members delete photo objects" on storage.objects;
create policy "trip members read photo objects" on storage.objects for select to authenticated
  using (bucket_id = 'trip-photos' and public.is_trip_member_by_slug(split_part(name, '/', 1)));
create policy "trip members upload photo objects" on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-photos' and public.is_trip_member_by_slug(split_part(name, '/', 1)));
create policy "trip members update photo objects" on storage.objects for update to authenticated
  using (bucket_id = 'trip-photos' and public.is_trip_member_by_slug(split_part(name, '/', 1)))
  with check (bucket_id = 'trip-photos' and public.is_trip_member_by_slug(split_part(name, '/', 1)));
create policy "trip members delete photo objects" on storage.objects for delete to authenticated
  using (bucket_id = 'trip-photos' and public.is_trip_member_by_slug(split_part(name, '/', 1)));

do $$
declare
  realtime_table text;
begin
  foreach realtime_table in array array['photos', 'notes', 'places', 'route_segments'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    end if;
  end loop;
end $$;
