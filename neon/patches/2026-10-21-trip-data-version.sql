-- Incremental patch for databases created from an earlier neon/schema.sql.
-- Adds trips.data_version, a counter that goes up on every write to a trip or
-- to any row the app loads for it. Open tabs poll this one number and download
-- the full trip only when it changed. Safe to re-run.
--
--   psql "$TARGET_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 \
--     --file=neon/patches/2026-10-21-trip-data-version.sql

begin;

alter table public.trips add column if not exists data_version bigint not null default 0;

-- Any update to a trip row moves the counter forward, including the bumps from
-- child-table triggers below, so a client-supplied value can never move it
-- backward or hold it still.
create or replace function public.bump_own_trip_data_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.data_version := old.data_version + 1;
  return new;
end;
$$;
revoke execute on function public.bump_own_trip_data_version() from public, anonymous, authenticated;

-- SECURITY DEFINER because members who may write photos or notes cannot update
-- the trips row themselves. The function only touches data_version.
create or replace function public.bump_trip_data_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.trips set data_version = data_version + 1 where id = old.trip_id;
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.trip_id is distinct from old.trip_id) then
    update public.trips set data_version = data_version + 1 where id = new.trip_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.bump_trip_data_version() from public, anonymous, authenticated;

drop trigger if exists trips_bump_data_version on public.trips;
create trigger trips_bump_data_version
  before update on public.trips
  for each row execute function public.bump_own_trip_data_version();

do $$
declare
  child text;
begin
  foreach child in array array['days', 'route_segments', 'photos', 'notes', 'places', 'trip_members', 'admin_requests'] loop
    execute format('drop trigger if exists %I on public.%I', child || '_bump_trip_data_version', child);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.bump_trip_data_version()',
      child || '_bump_trip_data_version',
      child
    );
  end loop;
end;
$$;

commit;
