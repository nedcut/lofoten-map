alter table public.photos
  add column if not exists media_type text not null default 'photo';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'photos_media_type_check'
      and conrelid = 'public.photos'::regclass
  ) then
    alter table public.photos
      add constraint photos_media_type_check
      check (media_type in ('photo', 'video'));
  end if;
end $$;
