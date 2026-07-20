-- Atomically map Supabase user UUIDs to Neon Auth UUIDs by normalized email,
-- validate the staged export, and load the eight public application tables.
-- This deliberately refuses to merge into non-empty target tables.

begin;

do $$
declare
  nonempty_tables text;
  duplicate_source_emails text;
  duplicate_target_emails text;
  unverified_source_emails text;
  unverified_target_emails text;
begin
  select string_agg(table_name, ', ' order by table_name)
  into nonempty_tables
  from (
    select 'admin_requests' as table_name where exists (select 1 from public.admin_requests)
    union all select 'days' where exists (select 1 from public.days)
    union all select 'notes' where exists (select 1 from public.notes)
    union all select 'photos' where exists (select 1 from public.photos)
    union all select 'places' where exists (select 1 from public.places)
    union all select 'route_segments' where exists (select 1 from public.route_segments)
    union all select 'trip_members' where exists (select 1 from public.trip_members)
    union all select 'trips' where exists (select 1 from public.trips)
  ) as populated;

  if nonempty_tables is not null then
    raise exception 'Target tables must be empty before migration; found data in: %', nonempty_tables;
  end if;

  select string_agg(email, ', ' order by email)
  into duplicate_source_emails
  from (
    select lower(email) as email
    from migration.source_users
    group by lower(email)
    having count(*) > 1
  ) as duplicates;

  if duplicate_source_emails is not null then
    raise exception 'Supabase users have duplicate normalized emails: %', duplicate_source_emails;
  end if;

  select string_agg(email, ', ' order by email)
  into duplicate_target_emails
  from (
    select lower(email) as email
    from neon_auth."user"
    group by lower(email)
    having count(*) > 1
  ) as duplicates;

  if duplicate_target_emails is not null then
    raise exception 'Neon Auth users have duplicate normalized emails: %', duplicate_target_emails;
  end if;

  select string_agg(email, ', ' order by email)
  into unverified_source_emails
  from migration.source_users
  where not email_verified;

  if unverified_source_emails is not null then
    raise exception 'Supabase email is not verified for: %', unverified_source_emails;
  end if;

  select string_agg(source.email, ', ' order by source.email)
  into unverified_target_emails
  from migration.source_users as source
  join neon_auth."user" as target
    on lower(target.email) = lower(source.email)
  where not target."emailVerified";

  if unverified_target_emails is not null then
    raise exception 'Neon Auth email is not verified for: %', unverified_target_emails;
  end if;

end;
$$;

create table migration.user_map (
  supabase_user_id text primary key references migration.source_users(supabase_user_id),
  neon_user_id uuid not null unique references neon_auth."user"(id),
  email text not null
);

insert into migration.user_map (supabase_user_id, neon_user_id, email)
select source.supabase_user_id, target.id, lower(target.email)
from migration.source_users as source
join neon_auth."user" as target
  on lower(target.email) = lower(source.email)
where source.email_verified
  and target."emailVerified";

do $$
declare
  missing_users text;
  missing_reference_ids text;
begin
  select string_agg(source.email, ', ' order by source.email)
  into missing_users
  from migration.source_users as source
  left join migration.user_map as mapped
    on mapped.supabase_user_id = source.supabase_user_id
  where mapped.supabase_user_id is null;

  if missing_users is not null then
    raise exception 'Create these users in Neon Auth before migration: %', missing_users;
  end if;

  select string_agg(referenced.supabase_user_id, ', ' order by referenced.supabase_user_id)
  into missing_reference_ids
  from (
    select supabase_user_id from migration.photos where supabase_user_id is not null
    union select supabase_user_id from migration.notes where supabase_user_id is not null
    union select supabase_user_id from migration.trip_members
    union select supabase_user_id from migration.admin_requests where supabase_user_id is not null
    union select resolved_by_supabase_user_id
      from migration.admin_requests
      where resolved_by_supabase_user_id is not null
  ) as referenced
  left join migration.user_map as mapped using (supabase_user_id)
  where mapped.supabase_user_id is null;

  if missing_reference_ids is not null then
    raise exception 'Referenced Supabase user IDs lack a verified Neon mapping: %', missing_reference_ids;
  end if;
end;
$$;

insert into public.trips (id, title, slug, description, start_date, end_date, created_at)
select id, title, slug, description, start_date, end_date, created_at
from migration.trips;

insert into public.days (id, trip_id, day_number, date, title, summary, created_at)
select id, trip_id, day_number, date, title, summary, created_at
from migration.days;

insert into public.route_segments (
  id, trip_id, day_id, name, source, mode, geometry_geojson,
  distance_meters, elevation_gain_meters, created_at
)
select id, trip_id, day_id, name, source, mode, geometry_geojson,
       distance_meters, elevation_gain_meters, created_at
from migration.route_segments;

insert into public.places (
  id, trip_id, day_id, name, lat, lng, place_type, description, created_at
)
select id, trip_id, day_id, name, lat, lng, place_type, description, created_at
from migration.places;

insert into public.trip_members (
  trip_id, user_id, role, display_name, avatar_path, created_at
)
select staged.trip_id,
       mapped.neon_user_id,
       staged.role,
       staged.display_name,
       staged.avatar_path,
       staged.created_at
from migration.trip_members as staged
join migration.user_map as mapped
  on mapped.supabase_user_id = staged.supabase_user_id;

insert into public.photos (
  id, trip_id, day_id, user_id, uploader_name, content_hash, media_type,
  image_path, thumbnail_path, lat, lng, taken_at, caption, exif_found, created_at
)
select staged.id,
       staged.trip_id,
       staged.day_id,
       mapped.neon_user_id,
       staged.uploader_name,
       staged.content_hash,
       staged.media_type,
       staged.image_path,
       staged.thumbnail_path,
       staged.lat,
       staged.lng,
       staged.taken_at,
       staged.caption,
       staged.exif_found,
       staged.created_at
from migration.photos as staged
left join migration.user_map as mapped
  on mapped.supabase_user_id = staged.supabase_user_id;

insert into public.notes (
  id, trip_id, day_id, user_id, author_name, lat, lng, body, note_type, created_at
)
select staged.id,
       staged.trip_id,
       staged.day_id,
       mapped.neon_user_id,
       staged.author_name,
       staged.lat,
       staged.lng,
       staged.body,
       staged.note_type,
       staged.created_at
from migration.notes as staged
left join migration.user_map as mapped
  on mapped.supabase_user_id = staged.supabase_user_id;

insert into public.admin_requests (
  id, trip_id, user_id, display_name, email, note, status,
  created_at, resolved_at, resolved_by
)
select staged.id,
       staged.trip_id,
       requester.neon_user_id,
       staged.display_name,
       staged.email,
       staged.note,
       staged.status,
       staged.created_at,
       staged.resolved_at,
       resolver.neon_user_id
from migration.admin_requests as staged
left join migration.user_map as requester
  on requester.supabase_user_id = staged.supabase_user_id
left join migration.user_map as resolver
  on resolver.supabase_user_id = staged.resolved_by_supabase_user_id;

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
      raise exception 'Atomic load row-count mismatch for %: staged %, target %',
        table_name, staged_count, target_count;
    end if;
  end loop;

  if exists (
    select 1
    from public.trips
    where not exists (
      select 1
      from public.trip_members
      where trip_members.trip_id = trips.id
        and trip_members.role = 'admin'
    )
  ) then
    raise exception 'At least one trip has no admin after user remapping';
  end if;
end;
$$;

commit;
