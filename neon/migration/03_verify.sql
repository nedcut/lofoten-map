-- Run on the target Neon branch after 02_apply_staging.sql.
-- Any mismatch or broken invariant aborts with a non-zero psql exit status.

\set ON_ERROR_STOP on

do $$
declare
  table_name text;
  staged_count bigint;
  target_count bigint;
begin
  foreach table_name in array array[
    'trips', 'days', 'route_segments', 'photos', 'notes', 'places',
    'trip_members', 'admin_requests'
  ] loop
    execute format('select count(*) from migration.%I', table_name) into staged_count;
    execute format('select count(*) from public.%I', table_name) into target_count;

    if staged_count <> target_count then
      raise exception 'Row-count mismatch for %: staged %, target %',
        table_name, staged_count, target_count;
    end if;
  end loop;

  if exists (
    select 1
    from public.photos
    where user_id is not null
      and not exists (select 1 from neon_auth."user" where id = photos.user_id)
  ) then
    raise exception 'photos contains an unmapped Neon Auth user_id';
  end if;

  if exists (
    select 1
    from public.notes
    where user_id is not null
      and not exists (select 1 from neon_auth."user" where id = notes.user_id)
  ) then
    raise exception 'notes contains an unmapped Neon Auth user_id';
  end if;

  if exists (
    select 1
    from public.trip_members
    where not exists (select 1 from neon_auth."user" where id = trip_members.user_id)
  ) then
    raise exception 'trip_members contains an unmapped Neon Auth user_id';
  end if;

  if exists (
    select 1
    from public.trips
    where not exists (
      select 1 from public.trip_members
      where trip_members.trip_id = trips.id
        and trip_members.role = 'admin'
    )
  ) then
    raise exception 'At least one trip has no admin after user remapping';
  end if;

  if exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    cross join lateral aclexplode(
      coalesce(pg_proc.proacl, acldefault('f', pg_proc.proowner))
    ) as function_acl
    where pg_namespace.nspname = 'public'
      and pg_proc.prosecdef
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute at least one public SECURITY DEFINER function';
  end if;
end;
$$;

select 'trips' as table_name, count(*) as row_count from public.trips
union all select 'days', count(*) from public.days
union all select 'route_segments', count(*) from public.route_segments
union all select 'photos', count(*) from public.photos
union all select 'notes', count(*) from public.notes
union all select 'places', count(*) from public.places
union all select 'trip_members', count(*) from public.trip_members
union all select 'admin_requests', count(*) from public.admin_requests
order by table_name;

select source.email,
       source.supabase_user_id,
       mapped.neon_user_id
from migration.source_users as source
join migration.user_map as mapped using (supabase_user_id)
order by source.email;
