-- Incremental patch for databases created from an earlier neon/schema.sql.
-- 1. update_my_trip_profile now accepts an avatar path only when it is null,
--    unchanged, or under the caller's own user id, so a member can no longer
--    point their profile at another member's avatar object and delete it.
-- 2. grant_trip_member_by_email and resolve_admin_request stop copying a user's
--    email address into trip_members.display_name, which anonymous visitors can
--    read. The data cleanup at the end removes emails already stored in public
--    columns. Safe to re-run.
--
--   psql "$TARGET_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 \
--     --file=neon/patches/2026-11-09-avatar-path-and-display-names.sql

begin;

create or replace function public.update_my_trip_profile(
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
  current_avatar_path text;
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

  select avatar_path into current_avatar_path
  from public.trip_members
  where trip_id = found_trip_id
    and user_id = nullif(auth.user_id(), '')::uuid;

  if not found then
    raise exception 'Join the trip before editing your profile' using errcode = '42501';
  end if;

  -- avatar_path is publicly readable and the storage delete route trusts it, so
  -- a member may only clear it, keep what they already have, or point it at a
  -- key under their own user id.
  if new_avatar_path is not null
     and new_avatar_path is distinct from current_avatar_path
     and not starts_with(new_avatar_path, auth.user_id() || '/') then
    raise exception 'Avatar path must belong to you' using errcode = '42501';
  end if;

  update public.trip_members
  set display_name = clean_name,
      avatar_path = new_avatar_path
  where trip_id = found_trip_id
    and user_id = nullif(auth.user_id(), '')::uuid;
end;
$$;
revoke execute on function public.update_my_trip_profile(text, text, text) from public, anonymous;
grant execute on function public.update_my_trip_profile(text, text, text) to authenticated;

create or replace function public.grant_trip_member_by_email(
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

  select id, nullif(btrim("name"), '')
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

create or replace function public.resolve_admin_request(request_id uuid, approve boolean)
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
    values (
      req.trip_id,
      req.user_id,
      'admin',
      case when req.display_name is distinct from req.email then req.display_name end
    )
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

-- One-off cleanup of emails already stored in publicly readable columns.
-- Idempotent: once cleaned, no row matches the email pattern again.

-- Members without a chosen name show as a friendly name derived in the app.
update public.trip_members
set display_name = null
where display_name ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

-- Photo and note bylines become the prettified local part of the email,
-- mirroring friendlyPersonName in lib/display-name.ts ('Friend' if nothing is left).
update public.photos
set uploader_name = coalesce(
  nullif(initcap(btrim(regexp_replace(split_part(uploader_name, '@', 1), '[._+-]+', ' ', 'g'))), ''),
  'Friend'
)
where uploader_name ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

update public.notes
set author_name = coalesce(
  nullif(initcap(btrim(regexp_replace(split_part(author_name, '@', 1), '[._+-]+', ' ', 'g'))), ''),
  'Friend'
)
where author_name ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

commit;
