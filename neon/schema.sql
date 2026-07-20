-- Lofoten Logbook schema for Neon Postgres + Neon Auth + Neon Data API.
--
-- Prerequisites:
--   1. Enable Neon Auth on this branch (creates neon_auth."user").
--   2. Enable the Neon Data API (creates authenticated/anonymous roles and
--      provides auth.user_id()).
--
-- This intentionally contains no Supabase Storage or Realtime objects. Media
-- paths remain opaque text and are resolved against Cloudflare R2 by the app.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('neon_auth."user"') is null then
    raise exception 'Neon Auth is not enabled: neon_auth."user" is missing';
  end if;

  if to_regprocedure('auth.user_id()') is null then
    raise exception 'Neon Data API auth is not enabled: auth.user_id() is missing';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anonymous') then
    raise exception 'Neon Data API roles authenticated/anonymous are missing';
  end if;
end;
$$;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  start_date date,
  end_date date,
  created_at timestamptz default now()
);

create table public.days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  day_number int not null,
  date date,
  title text,
  summary text,
  created_at timestamptz default now(),
  unique (trip_id, day_number)
);

create table public.route_segments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  day_id uuid references public.days(id) on delete set null,
  name text,
  source text,
  mode text default 'hike' check (mode in ('hike', 'ferry', 'bus', 'walk', 'other')),
  geometry_geojson jsonb not null,
  distance_meters double precision,
  elevation_gain_meters double precision,
  created_at timestamptz default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  day_id uuid references public.days(id) on delete set null,
  user_id uuid references neon_auth."user"(id) on delete set null
    default (nullif(auth.user_id(), '')::uuid),
  uploader_name text,
  content_hash text,
  media_type text not null default 'photo' check (media_type in ('photo', 'video')),
  image_path text not null,
  thumbnail_path text,
  lat double precision,
  lng double precision,
  taken_at timestamptz,
  caption text,
  exif_found boolean default false,
  created_at timestamptz default now()
);

create unique index photos_trip_content_hash_unique
  on public.photos (trip_id, content_hash)
  where content_hash is not null;

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  day_id uuid references public.days(id) on delete set null,
  user_id uuid references neon_auth."user"(id) on delete set null
    default (nullif(auth.user_id(), '')::uuid),
  author_name text,
  lat double precision not null,
  lng double precision not null,
  body text not null,
  note_type text default 'note',
  created_at timestamptz default now()
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  day_id uuid references public.days(id) on delete set null,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  place_type text,
  description text,
  created_at timestamptz default now()
);

create table public.trip_members (
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid references neon_auth."user"(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  display_name text,
  avatar_path text,
  created_at timestamptz default now(),
  primary key (trip_id, user_id)
);

create table public.admin_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid references neon_auth."user"(id) on delete cascade
    default (nullif(auth.user_id(), '')::uuid),
  display_name text,
  email text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references neon_auth."user"(id) on delete set null,
  unique (trip_id, user_id)
);

-- SECURITY DEFINER helpers are required to check membership without recursive
-- trip_members RLS. Every object name is schema-qualified and the search path is
-- empty. PUBLIC and anonymous EXECUTE are revoked immediately after creation.
create function public.current_user_id()
returns text
language sql
security invoker
set search_path = ''
stable
as $$
  select auth.user_id();
$$;
revoke execute on function public.current_user_id() from public, anonymous;
grant execute on function public.current_user_id() to authenticated;

create function public.is_trip_member(check_trip_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = check_trip_id
      and user_id = nullif(auth.user_id(), '')::uuid
  );
$$;
revoke execute on function public.is_trip_member(uuid) from public, anonymous;
grant execute on function public.is_trip_member(uuid) to authenticated;

create function public.is_trip_admin(check_trip_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = check_trip_id
      and user_id = nullif(auth.user_id(), '')::uuid
      and role = 'admin'
  );
$$;
revoke execute on function public.is_trip_admin(uuid) from public, anonymous;
grant execute on function public.is_trip_admin(uuid) to authenticated;

create function public.is_trip_member_by_slug(check_trip_slug text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.trips
    join public.trip_members on trip_members.trip_id = trips.id
    where trips.slug = check_trip_slug
      and trip_members.user_id = nullif(auth.user_id(), '')::uuid
  );
$$;
revoke execute on function public.is_trip_member_by_slug(text) from public, anonymous;
grant execute on function public.is_trip_member_by_slug(text) to authenticated;

-- Used only by the authenticated R2 avatar route when serving an existing
-- avatar whose object key still contains the user's old Supabase UUID. Exact
-- equality prevents this RPC from becoming a general object-prefix oracle.
create function public.is_my_avatar_path(check_path text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select nullif(auth.user_id(), '')::uuid is not null
    and check_path is not null
    and exists (
      select 1
      from public.trip_members
      where user_id = nullif(auth.user_id(), '')::uuid
        and avatar_path = check_path
    );
$$;
revoke execute on function public.is_my_avatar_path(text) from public, anonymous;
grant execute on function public.is_my_avatar_path(text) to authenticated;

create function public.grant_trip_member_by_email(
  target_trip_slug text,
  target_email text,
  target_role text default 'member'
)
returns table (
  trip_id uuid,
  user_id uuid,
  role text,
  display_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
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

  select id, coalesce(nullif("name", ''), email)
  into found_user_id, found_display_name
  from neon_auth."user"
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
  returning public.trip_members.trip_id,
            public.trip_members.user_id,
            public.trip_members.role,
            public.trip_members.display_name,
            public.trip_members.created_at
  into grant_trip_member_by_email.trip_id,
       grant_trip_member_by_email.user_id,
       grant_trip_member_by_email.role,
       grant_trip_member_by_email.display_name,
       grant_trip_member_by_email.created_at;

  return next;
end;
$$;
revoke execute on function public.grant_trip_member_by_email(text, text, text) from public, anonymous;
grant execute on function public.grant_trip_member_by_email(text, text, text) to authenticated;

create function public.update_my_trip_profile(
  target_trip_slug text,
  new_display_name text,
  new_avatar_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_trip_id uuid;
  clean_name text;
begin
  if nullif(auth.user_id(), '')::uuid is null then
    raise exception 'Must be signed in' using errcode = '42501';
  end if;

  select id into found_trip_id
  from public.trips
  where slug = target_trip_slug;

  if found_trip_id is null then
    raise exception 'Trip not found';
  end if;

  clean_name := nullif(btrim(new_display_name), '');

  update public.trip_members
  set display_name = clean_name,
      avatar_path = new_avatar_path
  where trip_id = found_trip_id
    and user_id = nullif(auth.user_id(), '')::uuid;

  if not found then
    raise exception 'Join the trip before editing your profile' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.update_my_trip_profile(text, text, text) from public, anonymous;
grant execute on function public.update_my_trip_profile(text, text, text) to authenticated;

create function public.request_trip_admin(
  target_trip_slug text,
  request_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_trip_id uuid;
  found_display_name text;
  found_email text;
begin
  if nullif(auth.user_id(), '')::uuid is null then
    raise exception 'Must be signed in' using errcode = '42501';
  end if;

  select id into found_trip_id
  from public.trips
  where slug = target_trip_slug;

  if found_trip_id is null then
    raise exception 'Trip not found';
  end if;

  if not public.is_trip_member(found_trip_id) then
    raise exception 'Join the trip before requesting admin' using errcode = '42501';
  end if;

  if public.is_trip_admin(found_trip_id) then
    raise exception 'You are already an admin';
  end if;

  select coalesce(nullif("name", ''), email), email
  into found_display_name, found_email
  from neon_auth."user"
  where id = nullif(auth.user_id(), '')::uuid;

  insert into public.admin_requests (trip_id, user_id, display_name, email, note, status)
  values (
    found_trip_id,
    nullif(auth.user_id(), '')::uuid,
    found_display_name,
    found_email,
    request_note,
    'pending'
  )
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
revoke execute on function public.request_trip_admin(text, text) from public, anonymous;
grant execute on function public.request_trip_admin(text, text) to authenticated;

create function public.set_member_role(
  target_trip_slug text,
  target_user_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_trip_id uuid;
  current_role text;
  remaining_admin_count int;
begin
  if new_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member';
  end if;

  select id into found_trip_id
  from public.trips
  where slug = target_trip_slug;

  if found_trip_id is null then
    raise exception 'Trip not found';
  end if;

  if not public.is_trip_admin(found_trip_id) then
    raise exception 'Only trip admins can change roles' using errcode = '42501';
  end if;

  select role into current_role
  from public.trip_members
  where trip_id = found_trip_id
    and user_id = target_user_id
  for update;

  if current_role is null then
    raise exception 'Member not found';
  end if;

  if current_role = 'admin' and new_role = 'member' then
    perform 1
    from public.trip_members
    where trip_id = found_trip_id
      and role = 'admin'
    for update;

    select count(*) into remaining_admin_count
    from public.trip_members
    where trip_id = found_trip_id
      and role = 'admin';

    if remaining_admin_count <= 1 then
      raise exception 'Cannot demote the last trip admin' using errcode = '23514';
    end if;
  end if;

  update public.trip_members
  set role = new_role
  where trip_id = found_trip_id
    and user_id = target_user_id;
end;
$$;
revoke execute on function public.set_member_role(text, uuid, text) from public, anonymous;
grant execute on function public.set_member_role(text, uuid, text) to authenticated;

create function public.resolve_admin_request(request_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.admin_requests;
begin
  select * into req
  from public.admin_requests
  where id = request_id;

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
    on conflict (trip_id, user_id) do update
      set role = 'admin';
  end if;

  update public.admin_requests
  set status = case when approve then 'approved' else 'denied' end,
      resolved_at = now(),
      resolved_by = nullif(auth.user_id(), '')::uuid
  where id = request_id;
end;
$$;
revoke execute on function public.resolve_admin_request(uuid, boolean) from public, anonymous;
grant execute on function public.resolve_admin_request(uuid, boolean) to authenticated;

grant usage on schema public to anonymous, authenticated;
grant select on table public.trips,
                      public.days,
                      public.route_segments,
                      public.photos,
                      public.notes,
                      public.places,
                      public.trip_members
  to anonymous;
grant select, insert, update, delete on table public.trips,
                                               public.days,
                                               public.route_segments,
                                               public.photos,
                                               public.notes,
                                               public.places,
                                               public.trip_members,
                                               public.admin_requests
  to authenticated;

alter table public.trips enable row level security;
alter table public.days enable row level security;
alter table public.route_segments enable row level security;
alter table public.photos enable row level security;
alter table public.notes enable row level security;
alter table public.places enable row level security;
alter table public.trip_members enable row level security;
alter table public.admin_requests enable row level security;

create policy "public read trips"
  on public.trips for select to anonymous, authenticated using (true);
create policy "admins write trips"
  on public.trips for all to authenticated
  using (public.is_trip_admin(id))
  with check (public.is_trip_admin(id));

create policy "public read days"
  on public.days for select to anonymous, authenticated using (true);
create policy "admins write days"
  on public.days for all to authenticated
  using (public.is_trip_admin(trip_id))
  with check (public.is_trip_admin(trip_id));

create policy "public read route segments"
  on public.route_segments for select to anonymous, authenticated using (true);
create policy "admins write route segments"
  on public.route_segments for all to authenticated
  using (public.is_trip_admin(trip_id))
  with check (public.is_trip_admin(trip_id));

create policy "public read places"
  on public.places for select to anonymous, authenticated using (true);
create policy "admins write places"
  on public.places for all to authenticated
  using (public.is_trip_admin(trip_id))
  with check (public.is_trip_admin(trip_id));

create policy "public read photos"
  on public.photos for select to anonymous, authenticated using (true);
create policy "members insert own photos"
  on public.photos for insert to authenticated
  with check (
    public.is_trip_member(trip_id)
    and user_id = nullif(auth.user_id(), '')::uuid
  );
create policy "owners or admins update photos"
  on public.photos for update to authenticated
  using (
    user_id = nullif(auth.user_id(), '')::uuid
    or public.is_trip_admin(trip_id)
  )
  with check (
    user_id = nullif(auth.user_id(), '')::uuid
    or public.is_trip_admin(trip_id)
  );
create policy "owners or admins delete photos"
  on public.photos for delete to authenticated
  using (
    user_id = nullif(auth.user_id(), '')::uuid
    or public.is_trip_admin(trip_id)
  );

create policy "public read notes"
  on public.notes for select to anonymous, authenticated using (true);
create policy "members insert own notes"
  on public.notes for insert to authenticated
  with check (
    public.is_trip_member(trip_id)
    and user_id = nullif(auth.user_id(), '')::uuid
  );
create policy "owners or admins update notes"
  on public.notes for update to authenticated
  using (
    user_id = nullif(auth.user_id(), '')::uuid
    or public.is_trip_admin(trip_id)
  )
  with check (
    user_id = nullif(auth.user_id(), '')::uuid
    or public.is_trip_admin(trip_id)
  );
create policy "owners or admins delete notes"
  on public.notes for delete to authenticated
  using (
    user_id = nullif(auth.user_id(), '')::uuid
    or public.is_trip_admin(trip_id)
  );

create policy "public read trip memberships"
  on public.trip_members for select to anonymous, authenticated using (true);
create policy "admins write trip memberships"
  on public.trip_members for all to authenticated
  using (public.is_trip_admin(trip_id))
  with check (public.is_trip_admin(trip_id));

create policy "requesters and admins read admin requests"
  on public.admin_requests for select to authenticated
  using (
    user_id = nullif(auth.user_id(), '')::uuid
    or public.is_trip_admin(trip_id)
  );

commit;
