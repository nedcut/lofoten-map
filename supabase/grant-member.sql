-- Run this after:
-- 1. supabase/schema.sql
-- 2. supabase/seed.sql
-- 3. The user has signed in once through the app magic-link flow.
--
-- Replace the email and role before running.

insert into trip_members (trip_id, user_id, role, display_name)
select
  trips.id,
  auth.users.id,
  'admin',
  coalesce(auth.users.raw_user_meta_data ->> 'full_name', auth.users.email)
from trips
join auth.users on auth.users.email = 'you@example.com'
where trips.slug = 'lofoten-2026'
on conflict (trip_id, user_id) do update
set role = excluded.role,
    display_name = excluded.display_name;
