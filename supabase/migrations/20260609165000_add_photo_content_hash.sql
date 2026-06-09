alter table photos add column if not exists content_hash text;

create unique index if not exists photos_trip_content_hash_unique
  on photos (trip_id, content_hash)
  where content_hash is not null;
