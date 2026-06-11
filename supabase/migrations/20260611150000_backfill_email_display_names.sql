-- Backfill email-shaped bylines to friendly names.
--
-- Older photo rows stored the signed-in email as uploader_name when the
-- member had no display name set. The app now formats these at render time
-- (lib/display-name.ts friendlyPersonName) and no longer writes emails, but
-- reads are public via the anon key, so the raw values were still visible to
-- anyone querying the REST API directly.
--
-- Pass 1 sources the name the app would use today: the member's display_name.
-- Pass 2 prettifies whatever email-shaped values remain (owner no longer a
-- member, or no display name) with the same logic as friendlyPersonName:
-- email local part, split on [._+-], each word capitalized, joined by spaces
-- ("ned.cutler@gmail.com" -> "Ned Cutler").
--
-- Idempotent: rewritten values no longer match the email pattern.

update public.photos as photo
set uploader_name = member.display_name
from public.trip_members as member
where member.trip_id = photo.trip_id
  and member.user_id = photo.user_id
  and coalesce(member.display_name, '') <> ''
  and photo.uploader_name ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

update public.photos
set uploader_name = coalesce(
  (
    select string_agg(upper(left(word, 1)) || substr(word, 2), ' ' order by ord)
    from regexp_split_to_table(split_part(uploader_name, '@', 1), '[._+-]+') with ordinality as parts(word, ord)
    where word <> ''
  ),
  'Friend'
)
where uploader_name ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

update public.notes as note
set author_name = member.display_name
from public.trip_members as member
where member.trip_id = note.trip_id
  and member.user_id = note.user_id
  and coalesce(member.display_name, '') <> ''
  and note.author_name ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';

update public.notes
set author_name = coalesce(
  (
    select string_agg(upper(left(word, 1)) || substr(word, 2), ' ' order by ord)
    from regexp_split_to_table(split_part(author_name, '@', 1), '[._+-]+') with ordinality as parts(word, ord)
    where word <> ''
  ),
  'Friend'
)
where author_name ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
