import type { Feature, LineString } from "geojson";

export type RouteMode = "hike" | "ferry" | "bus" | "walk" | "other";

export type Trip = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export type Day = {
  id: string;
  trip_id: string;
  day_number: number;
  date: string | null;
  title: string | null;
  summary: string | null;
  created_at: string;
};

export type RouteSegment = {
  id: string;
  trip_id: string;
  day_id: string | null;
  name: string | null;
  source: string | null;
  mode: RouteMode;
  geometry_geojson: Feature<LineString> | LineString;
  distance_meters: number | null;
  elevation_gain_meters: number | null;
  created_at: string;
};

export type Photo = {
  id: string;
  trip_id: string;
  day_id: string | null;
  user_id: string | null;
  uploader_name: string | null;
  image_path: string;
  thumbnail_path: string | null;
  // Signed URLs generated at read time from the paths above. Null until signed
  // (or when signing fails); short-lived, so they are never persisted.
  image_url: string | null;
  thumbnail_url: string | null;
  lat: number | null;
  lng: number | null;
  taken_at: string | null;
  caption: string | null;
  exif_found: boolean;
  created_at: string;
};

export type Note = {
  id: string;
  trip_id: string;
  day_id: string | null;
  user_id: string | null;
  author_name: string | null;
  lat: number;
  lng: number;
  body: string;
  note_type: string | null;
  created_at: string;
};

export type Place = {
  id: string;
  trip_id: string;
  day_id: string | null;
  name: string;
  lat: number;
  lng: number;
  place_type: string | null;
  description: string | null;
  created_at: string;
};

export type TripMember = {
  trip_id: string;
  user_id: string;
  role: "admin" | "member";
  display_name: string | null;
  created_at: string;
};

export type TripData = {
  trip: Trip | null;
  days: Day[];
  routeSegments: RouteSegment[];
  photos: Photo[];
  notes: Note[];
  places: Place[];
  members: TripMember[];
};

export type MapClickMode = "idle" | "add-note" | "place-photo" | "draw-route";
export type LngLat = { lng: number; lat: number };
