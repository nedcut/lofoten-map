-- Incremental patch for databases that already have the 2026-11-09 patch
-- (apply it after 2026-11-09-avatar-path-and-display-names.sql).
-- 1. Adds a trigger on public.trip_members that rejects an avatar_path which is
--    not null, unchanged, or under the row's own user id. The trip-admin RLS
--    policy lets admins update trip_members directly, so an admin could point
--    their own row at another user's avatar key and then delete that file. The
--    trigger applies only when auth.user_id() is set (API callers); the database
--    owner, psql and neon/migration/ are not checked. Existing rows are not
--    revalidated.
-- 2. grant_trip_member_by_email also stores a null display_name when the
--    account's name is itself the email address.
--    Safe to re-run.
--
--   psql "$TARGET_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 \
--     --file=neon/patches/2026-11-10-avatar-path-trigger.sql

begin;

-- trip_members.avatar_path is publicly readable and the storage delete route
-- trusts it (see is_my_avatar_path), so a row may only hold a key under its own
-- user id, or the value it already had (legacy keys under an old Supabase id).
-- The trip-admin RLS policy lets admins write trip_members directly, so the rule
-- lives on the table. It checks new.user_id (the row's owner), not the caller.
-- It applies only to API callers: sessions with no auth.user_id() (the database
-- owner, psql, neon/migration/) are not checked.
create or replace function public.check_trip_member_avatar_path()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if nullif(auth.user_id(), '') is null then
    return new;
  end if;

  if new.avatar_path is null
     or (tg_op = 'UPDATE' and new.avatar_path is not distinct from old.avatar_path)
     or starts_with(new.avatar_path, new.user_id::text || '/') then
    return new;
  end if;

  raise exception 'Avatar path must belong to the member' using errcode = '42501';
end;
$$;
revoke execute on function public.check_trip_member_avatar_path() from public, anonymous, authenticated;

drop trigger if exists trip_members_check_avatar_path on public.trip_members;
create trigger trip_members_check_avatar_path
  before insert or update of avatar_path on public.trip_members
  for each row execute function public.check_trip_member_avatar_path();

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
#variable_conflict use_column
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

  select id,
         case
           when nullif(btrim("name"), '') is null then null
           when lower(btrim("name")) = lower(btrim(email)) then null
           when btrim("name") ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then null
           else btrim("name")
         end
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

commit;
