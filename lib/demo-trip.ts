import type { Day, Note, Place, RouteSegment, Trip, TripData } from "@/types/trip";

export const demoTripId = "00000000-0000-4000-8000-000000000001";
export const demoCreatedAt = "2026-01-01T00:00:00.000Z";

export const demoDays: Day[] = [
  { id: "00000000-0000-4000-8000-000000000101", trip_id: demoTripId, day_number: 1, date: "2026-07-12", title: "Reine arrival", summary: "Settle in, ferry views, and first village walk.", created_at: demoCreatedAt },
  { id: "00000000-0000-4000-8000-000000000102", trip_id: demoTripId, day_number: 2, date: "2026-07-13", title: "Kjerkfjorden hike", summary: "Trail day toward fjord viewpoints.", created_at: demoCreatedAt },
  { id: "00000000-0000-4000-8000-000000000103", trip_id: demoTripId, day_number: 3, date: "2026-07-14", title: "Moskenes coast", summary: "Weather window, photo stops, and camp scouting.", created_at: demoCreatedAt },
];

export const demoTrip: Trip = {
  id: demoTripId,
  title: "Lofoten 2026",
  slug: "lofoten-2026",
  description: "A shared Lofoten hiking logbook.",
  start_date: "2026-07-12",
  end_date: "2026-07-18",
  created_at: demoCreatedAt,
};

export const demoRoutes: RouteSegment[] = [{
  id: "route-demo",
  trip_id: demoTripId,
  day_id: demoDays[1].id,
  name: "Reine to Kjerkfjorden scouting route",
  source: "seed",
  mode: "hike",
  geometry_geojson: { type: "LineString", coordinates: [[13.089, 67.932], [13.068, 67.941], [13.045, 67.954], [13.019, 67.967]] },
  distance_meters: 6200,
  elevation_gain_meters: 420,
  created_at: demoCreatedAt,
}];

export const demoNotes: Note[] = [{
  id: "note-demo-1",
  trip_id: demoTripId,
  day_id: demoDays[0].id,
  user_id: null,
  author_name: "Maja",
  lat: 67.9328,
  lng: 13.0888,
  body: "Sunset light on Reinebringen looked unreal from the harbor.",
  note_type: "note",
  created_at: demoCreatedAt,
}];

export const demoPlaces: Place[] = [{
  id: "place-demo-1",
  trip_id: demoTripId,
  day_id: demoDays[2].id,
  name: "Coffee and cinnamon buns",
  lat: 67.9007,
  lng: 13.0461,
  place_type: "food",
  description: "Good meetup stop before the ferry.",
  created_at: demoCreatedAt,
}];

export const demoTripData: TripData = {
  trip: demoTrip,
  days: demoDays,
  routeSegments: demoRoutes,
  photos: [],
  notes: demoNotes,
  places: demoPlaces,
  members: [],
  adminRequests: [],
};

export const emptyTripData: TripData = {
  trip: null,
  days: [],
  routeSegments: [],
  photos: [],
  notes: [],
  places: [],
  members: [],
  adminRequests: [],
};
