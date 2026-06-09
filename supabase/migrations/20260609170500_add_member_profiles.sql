-- Member profiles: a per-trip display name (already present) plus an avatar.
-- Avatars live in their own public bucket and are referenced by storage path,
-- exactly like trip photos -- the public URL is built at read time, never stored.

alter table public.trip_members
  add column if not exists avatar_path text;

-- Self-service profile edit. trip_members is otherwise admin-write-only (see the
-- "admins write trip memberships" policy), so members reach their own row through
-- this security-definer RPC. It hard-codes auth.uid() as the target, so a caller
-- can only ever edit themselves -- never another member's name or avatar.
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

  -- Treat a blank name as "clear it" so the display falls back to email/full_name.
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

-- Public avatars bucket: rendered via plain public URLs for everyone, no signing.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

-- Authorization keys off the object's first path segment being the caller's own
-- user id, so every avatar lives at "<user_id>/<file>" and you can only write
-- your own. Mirrors the trip-photos slug-prefix pattern, swapping slug for uid.
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
