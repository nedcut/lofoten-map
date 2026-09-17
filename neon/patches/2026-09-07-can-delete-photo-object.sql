-- Incremental patch for databases created from an earlier neon/schema.sql.
-- Adds the per-object authorization RPC used by /api/storage/delete so trip
-- membership alone no longer allows deleting another member's photo files.
-- Safe to re-run.
--
--   psql "$TARGET_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 \
--     --file=neon/patches/2026-09-07-can-delete-photo-object.sql

drop function if exists public.can_delete_photo_object(text, text);

-- Used only by the authenticated R2 delete route. Mirrors the photos DELETE
-- policy at the object level: a caller may remove an object only when every
-- photo row referencing it is their own, or any object in a trip they
-- administer. Insert/update policies do not constrain image paths, so a row a
-- member points at someone else's object must not unlock that object. An object
-- that no row references (an orphan left by a failed upload) may be removed by
-- any member of that trip, so the client's best-effort rollback keeps working.
-- Trip membership alone is never enough to delete another member's file.
create function public.can_delete_photo_object(check_trip_slug text, check_path text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  with caller as (
    select nullif(auth.user_id(), '')::uuid as id
  ),
  trip as (
    select id from public.trips where slug = check_trip_slug
  ),
  refs as (
    select photos.user_id
    from public.photos
    join trip on photos.trip_id = trip.id
    where photos.image_path = check_path
       or photos.thumbnail_path = check_path
  )
  select (select id from caller) is not null
    and check_path is not null
    and exists (select 1 from trip)
    and case
      when exists (select 1 from refs)
        then not exists (select 1 from refs, caller where refs.user_id is distinct from caller.id)
          or public.is_trip_admin((select id from trip))
      else public.is_trip_member((select id from trip))
    end;
$$;
revoke execute on function public.can_delete_photo_object(text, text) from public, anonymous;
grant execute on function public.can_delete_photo_object(text, text) to authenticated;
