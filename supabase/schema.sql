-- Lofoten Logbook MVP schema
-- Reads are public (anyone can view the trip without an account); editing is
-- restricted to invited trip members. Run seed.sql after this schema, then add
-- at least one auth user to trip_members from SQL.

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
  content_hash text,
  image_path text not null,
  thumbnail_path text,
  lat double precision,
  lng double precision,
  taken_at timestamptz,
  caption text,
  exif_found boolean default false,
  created_at timestamptz default now()
);

-- Migrate existing databases from public-URL columns to storage-path columns.
-- Idempotent: only renames when the old columns still exist, then strips any
-- legacy full-URL values down to the bare storage path.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'photos' and column_name = 'image_url'
  ) then
    alter table photos rename column image_url to image_path;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_name = 'photos' and column_name = 'thumbnail_url'
  ) then
    alter table photos rename column thumbnail_url to thumbnail_path;
  end if;
end $$;

update photos
  set image_path = regexp_replace(image_path, '^.*/object/public/trip-photos/', '')
  where image_path like '%/object/public/trip-photos/%';
update photos
  set thumbnail_path = regexp_replace(thumbnail_path, '^.*/object/public/trip-photos/', '')
  where thumbnail_path like '%/object/public/trip-photos/%';

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
  avatar_path text,
  created_at timestamptz default now(),
  primary key (trip_id, user_id)
);

-- Admin-upgrade requests. Any trip member can ask to become an admin; existing
-- admins approve or deny. One active request per user per trip (re-requesting
-- resets the same row back to 'pending'). Inserts/updates flow through the
-- security-definer RPCs below, never direct client writes.
create table if not exists admin_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
  display_name text,
  email text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  unique (trip_id, user_id)
);

alter table photos add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
alter table photos add column if not exists content_hash text;

create unique index if not exists photos_trip_content_hash_unique
  on photos (trip_id, content_hash)
  where content_hash is not null;
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

-- Self-service join: a signed-in user adds themselves to the trip as a plain
-- member if they are not already on it. Idempotent, so the client can call it on
-- every sign-in without worrying about duplicates.
create or replace function public.ensure_trip_membership(target_trip_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found_trip_id uuid;
  found_display_name text;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in' using errcode = '42501';
  end if;

  select id into found_trip_id from public.trips where slug = target_trip_slug;
  if found_trip_id is null then
    raise exception 'Trip not found';
  end if;

  select coalesce(raw_user_meta_data ->> 'full_name', email)
  into found_display_name
  from auth.users where id = auth.uid();

  insert into public.trip_members (trip_id, user_id, role, display_name)
  values (found_trip_id, auth.uid(), 'member', found_display_name)
  on conflict (trip_id, user_id) do nothing;
end;
$$;

grant execute on function public.ensure_trip_membership(text) to authenticated;

-- Self-service profile edit. trip_members is otherwise admin-write-only, so
-- members reach their own row through this security-definer RPC.
create or replace function public.update_my_trip_profile(
  target_trip_slug text,
  new_display_name text,
  new_avatar_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found_trip_id uuid;
  clean_name text;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in' using errcode = '42501';
  end if;

  select id into found_trip_id from public.trips where slug = target_trip_slug;
  if found_trip_id is null then
    raise exception 'Trip not found';
  end if;

  clean_name := nullif(btrim(new_display_name), '');

  update public.trip_members
    set display_name = clean_name,
        avatar_path = new_avatar_path
  where trip_id = found_trip_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Join the trip before editing your profile' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.update_my_trip_profile(text, text, text) to authenticated;

-- A trip member asks to be upgraded to admin. Captures their name/email from
-- auth.users (which the client cannot read) and upserts a pending request.
create or replace function public.request_trip_admin(target_trip_slug text, request_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found_trip_id uuid;
  found_display_name text;
  found_email text;
begin
  if auth.uid() is null then
    raise exception 'Must be signed in' using errcode = '42501';
  end if;

  select id into found_trip_id from public.trips where slug = target_trip_slug;
  if found_trip_id is null then
    raise exception 'Trip not found';
  end if;

  if not public.is_trip_member(found_trip_id) then
    raise exception 'Join the trip before requesting admin' using errcode = '42501';
  end if;

  if public.is_trip_admin(found_trip_id) then
    raise exception 'You are already an admin';
  end if;

  select coalesce(raw_user_meta_data ->> 'full_name', email), email
  into found_display_name, found_email
  from auth.users where id = auth.uid();

  insert into public.admin_requests (trip_id, user_id, display_name, email, note, status)
  values (found_trip_id, auth.uid(), found_display_name, found_email, request_note, 'pending')
  on conflict (trip_id, user_id) do update
    set status = 'pending',
        note = excluded.note,
        display_name = excluded.display_name,
        email = excluded.email,
        created_at = now(),
        resolved_at = null,
        resolved_by = null;
end;
$$;

grant execute on function public.request_trip_admin(text, text) to authenticated;

-- Promote or demote an existing member. Admin-only. Guards against demoting the
-- last remaining admin, which would leave the trip with no one able to manage it.
create or replace function public.set_member_role(target_trip_slug text, target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  found_trip_id uuid;
  current_role text;
  remaining_admin_count int;
begin
  if new_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member';
  end if;

  select id into found_trip_id from public.trips where slug = target_trip_slug;
  if found_trip_id is null then
    raise exception 'Trip not found';
  end if;

  if not public.is_trip_admin(found_trip_id) then
    raise exception 'Only trip admins can change roles' using errcode = '42501';
  end if;

  select role into current_role
  from public.trip_members
  where trip_id = found_trip_id and user_id = target_user_id
  for update;

  if current_role is null then
    raise exception 'Member not found';
  end if;

  if current_role = 'admin' and new_role = 'member' then
    perform 1
    from public.trip_members
    where trip_id = found_trip_id and role = 'admin'
    for update;

    select count(*) into remaining_admin_count
    from public.trip_members
    where trip_id = found_trip_id and role = 'admin';

    if remaining_admin_count <= 1 then
      raise exception 'Cannot demote the last trip admin' using errcode = '23514';
    end if;
  end if;

  update public.trip_members
    set role = new_role
    where trip_id = found_trip_id and user_id = target_user_id;
end;
$$;

grant execute on function public.set_member_role(text, uuid, text) to authenticated;

-- Approve or deny a pending admin request. Admin-only. Approving promotes the
-- requester to admin; either way the request is stamped resolved.
create or replace function public.resolve_admin_request(request_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.admin_requests;
begin
  select * into req from public.admin_requests where id = request_id;
  if req.id is null then
    raise exception 'Request not found';
  end if;

  if not public.is_trip_admin(req.trip_id) then
    raise exception 'Only trip admins can resolve requests' using errcode = '42501';
  end if;

  if req.status <> 'pending' then
    raise exception 'Request has already been resolved';
  end if;

  if approve then
    insert into public.trip_members (trip_id, user_id, role, display_name)
    values (req.trip_id, req.user_id, 'admin', req.display_name)
    on conflict (trip_id, user_id) do update set role = 'admin';
  end if;

  update public.admin_requests
    set status = case when approve then 'approved' else 'denied' end,
        resolved_at = now(),
        resolved_by = auth.uid()
    where id = request_id;
end;
$$;

grant execute on function public.resolve_admin_request(uuid, boolean) to authenticated;

grant usage on schema public to anon, authenticated;
grant all on table trips, days, route_segments, photos, notes, places, trip_members, admin_requests to authenticated;
-- Public reads: anon needs the table-level SELECT privilege; RLS ("public read"
-- policies above) still governs which rows it sees.
grant select on table trips, days, route_segments, photos, notes, places, trip_members to anon;
grant usage on all sequences in schema public to authenticated;

alter table trips enable row level security;
alter table days enable row level security;
alter table route_segments enable row level security;
alter table photos enable row level security;
alter table notes enable row level security;
alter table places enable row level security;
alter table trip_members enable row level security;
alter table admin_requests enable row level security;

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

-- Reads are public (anon + authenticated): anyone can view the trip without an
-- account. Writes stay locked to signed-in members/admins via the helpers above.
drop policy if exists "members read trips" on trips;
drop policy if exists "public read trips" on trips;
drop policy if exists "admins write trips" on trips;
create policy "public read trips" on trips for select to anon, authenticated using (true);
create policy "admins write trips" on trips for all to authenticated using (public.is_trip_admin(id)) with check (public.is_trip_admin(id));

drop policy if exists "members read days" on days;
drop policy if exists "public read days" on days;
drop policy if exists "admins write days" on days;
create policy "public read days" on days for select to anon, authenticated using (true);
create policy "admins write days" on days for all to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

drop policy if exists "members read route segments" on route_segments;
drop policy if exists "public read route segments" on route_segments;
drop policy if exists "admins write route segments" on route_segments;
create policy "public read route segments" on route_segments for select to anon, authenticated using (true);
create policy "admins write route segments" on route_segments for all to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

drop policy if exists "members read places" on places;
drop policy if exists "public read places" on places;
drop policy if exists "admins write places" on places;
create policy "public read places" on places for select to anon, authenticated using (true);
create policy "admins write places" on places for all to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

drop policy if exists "members read photos" on photos;
drop policy if exists "public read photos" on photos;
drop policy if exists "members insert own photos" on photos;
drop policy if exists "owners or admins update photos" on photos;
drop policy if exists "owners or admins delete photos" on photos;
create policy "public read photos" on photos for select to anon, authenticated using (true);
create policy "members insert own photos" on photos for insert to authenticated with check (public.is_trip_member(trip_id) and user_id = auth.uid());
create policy "owners or admins update photos" on photos for update to authenticated using (user_id = auth.uid() or public.is_trip_admin(trip_id)) with check (user_id = auth.uid() or public.is_trip_admin(trip_id));
create policy "owners or admins delete photos" on photos for delete to authenticated using (user_id = auth.uid() or public.is_trip_admin(trip_id));

drop policy if exists "members read notes" on notes;
drop policy if exists "public read notes" on notes;
drop policy if exists "members insert own notes" on notes;
drop policy if exists "owners or admins update notes" on notes;
drop policy if exists "owners or admins delete notes" on notes;
create policy "public read notes" on notes for select to anon, authenticated using (true);
create policy "members insert own notes" on notes for insert to authenticated with check (public.is_trip_member(trip_id) and user_id = auth.uid());
create policy "owners or admins update notes" on notes for update to authenticated using (user_id = auth.uid() or public.is_trip_admin(trip_id)) with check (user_id = auth.uid() or public.is_trip_admin(trip_id));
create policy "owners or admins delete notes" on notes for delete to authenticated using (user_id = auth.uid() or public.is_trip_admin(trip_id));

drop policy if exists "members read trip memberships" on trip_members;
drop policy if exists "public read trip memberships" on trip_members;
drop policy if exists "admins write trip memberships" on trip_members;
create policy "public read trip memberships" on trip_members for select to anon, authenticated using (true);
create policy "admins write trip memberships" on trip_members for all to authenticated using (public.is_trip_admin(trip_id)) with check (public.is_trip_admin(trip_id));

-- Admin requests are private: you can see your own request, and admins see every
-- request for trips they manage. All writes go through the security-definer RPCs
-- above, so there are deliberately no insert/update policies for authenticated.
drop policy if exists "requesters and admins read admin requests" on admin_requests;
create policy "requesters and admins read admin requests" on admin_requests for select to authenticated
  using (user_id = auth.uid() or public.is_trip_admin(trip_id));

-- Public bucket: photos render via plain public URLs for everyone, no signing.
insert into storage.buckets (id, name, public)
values ('trip-photos', 'trip-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "trip members read photo objects" on storage.objects;
drop policy if exists "public read photo objects" on storage.objects;
drop policy if exists "trip members upload photo objects" on storage.objects;
drop policy if exists "trip members update photo objects" on storage.objects;
drop policy if exists "trip members delete photo objects" on storage.objects;
create policy "public read photo objects" on storage.objects for select to anon, authenticated
  using (bucket_id = 'trip-photos');
create policy "trip members upload photo objects" on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-photos' and public.is_trip_member_by_slug(split_part(name, '/', 1)));
create policy "trip members update photo objects" on storage.objects for update to authenticated
  using (bucket_id = 'trip-photos' and public.is_trip_member_by_slug(split_part(name, '/', 1)))
  with check (bucket_id = 'trip-photos' and public.is_trip_member_by_slug(split_part(name, '/', 1)));
create policy "trip members delete photo objects" on storage.objects for delete to authenticated
  using (bucket_id = 'trip-photos' and public.is_trip_member_by_slug(split_part(name, '/', 1)));

-- Public avatars bucket: rendered via plain public URLs for everyone, no signing.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "public read avatar objects" on storage.objects;
drop policy if exists "users upload own avatar objects" on storage.objects;
drop policy if exists "users update own avatar objects" on storage.objects;
drop policy if exists "users delete own avatar objects" on storage.objects;
create policy "public read avatar objects" on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
create policy "users upload own avatar objects" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own avatar objects" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own avatar objects" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

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
