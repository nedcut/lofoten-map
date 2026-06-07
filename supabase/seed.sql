insert into trips (id, title, slug, description, start_date, end_date)
values ('00000000-0000-4000-8000-000000000001', 'Lofoten 2026', 'lofoten-2026', 'A collaborative hiking journal around Reine, Moskenes, and Kjerkfjorden.', '2026-07-12', '2026-07-18')
on conflict (slug) do update set title = excluded.title, description = excluded.description;

insert into days (id, trip_id, day_number, date, title, summary) values
('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 1, '2026-07-12', 'Reine arrival', 'Settle in, walk the harbor, and plan the first route.'),
('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 2, '2026-07-13', 'Kjerkfjorden hike', 'A fjord-side hiking day with photo stops.'),
('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 3, '2026-07-14', 'Moskenes coast', 'Coastal scouting, ferry views, and backup weather plans.'),
('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 4, '2026-07-15', 'Open summit window', 'Placeholder day for the best-weather hike.')
on conflict (trip_id, day_number) do update set title = excluded.title, summary = excluded.summary;

insert into route_segments (id, trip_id, day_id, name, source, mode, geometry_geojson, distance_meters, elevation_gain_meters)
values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000102',
  'Reine to Kjerkfjorden scouting route',
  'manual-seed',
  'hike',
  '{"type":"LineString","coordinates":[[13.089,67.932],[13.068,67.941],[13.045,67.954],[13.019,67.967],[12.993,67.979]]}'::jsonb,
  7200,
  520
)
on conflict (id) do update set geometry_geojson = excluded.geometry_geojson;

insert into notes (id, trip_id, day_id, author_name, lat, lng, body, note_type) values
('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Maja', 67.9328, 13.0888, 'Sunset light on Reinebringen looked unreal from the harbor.', 'note'),
('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'Jonas', 67.9540, 13.0450, 'Good snack stop with wind shelter behind the rocks.', 'note')
on conflict (id) do update set body = excluded.body;

insert into places (id, trip_id, day_id, name, lat, lng, place_type, description) values
('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', 'Moskenes ferry viewpoint', 67.9007, 13.0461, 'viewpoint', 'Great place for ferry photos and weather checks.'),
('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'Reine coffee stop', 67.9321, 13.0895, 'food', 'Easy meetup point before the first walk.')
on conflict (id) do update set description = excluded.description;
