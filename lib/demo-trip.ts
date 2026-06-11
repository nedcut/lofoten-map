import type { Day, Note, Photo, Place, RouteSegment, Trip, TripData } from "@/types/trip";

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

// Self-contained placeholder "photos": SVG data URIs need no Storage bucket
// or network, so markers and popups work in demo mode and e2e runs.
function placeholderImage(label: string, sky: string, ridge: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${sky}"/><polygon points="0,600 220,260 380,470 540,210 800,600" fill="${ridge}"/><text x="24" y="60" font-family="sans-serif" font-size="36" fill="#fffdf6">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const demoPhotoImages = [
  placeholderImage("Reine harbor", "#9fb8c8", "#33524a"),
  placeholderImage("Fjord viewpoint", "#b8c8a0", "#2e4a3d"),
  placeholderImage("Coastal camp", "#d8b890", "#4a3d2e"),
];

export const demoPhotos: Photo[] = [
  {
    id: "photo-demo-1",
    trip_id: demoTripId,
    day_id: demoDays[0].id,
    user_id: null,
    uploader_name: "Maja",
    content_hash: "demo-hash-1",
    media_type: "photo",
    image_path: "",
    thumbnail_path: null,
    image_url: demoPhotoImages[0],
    thumbnail_url: demoPhotoImages[0],
    lat: 67.9332,
    lng: 13.0875,
    taken_at: "2026-07-12T18:40:00Z",
    caption: "Reine harbor at golden hour",
    exif_found: true,
    created_at: demoCreatedAt,
  },
  {
    id: "photo-demo-2",
    trip_id: demoTripId,
    day_id: demoDays[1].id,
    user_id: null,
    uploader_name: "Ned",
    content_hash: "demo-hash-2",
    media_type: "photo",
    image_path: "",
    thumbnail_path: null,
    image_url: demoPhotoImages[1],
    thumbnail_url: demoPhotoImages[1],
    lat: 67.9545,
    lng: 13.0448,
    taken_at: "2026-07-13T11:15:00Z",
    caption: "Halfway up toward Kjerkfjorden",
    exif_found: true,
    created_at: demoCreatedAt,
  },
  {
    id: "photo-demo-3",
    trip_id: demoTripId,
    day_id: demoDays[2].id,
    user_id: null,
    uploader_name: "Maja",
    content_hash: "demo-hash-3",
    media_type: "photo",
    image_path: "",
    thumbnail_path: null,
    image_url: demoPhotoImages[2],
    thumbnail_url: demoPhotoImages[2],
    lat: 67.9012,
    lng: 13.0489,
    taken_at: "2026-07-14T15:05:00Z",
    caption: "Camp spot scouting on the Moskenes coast",
    exif_found: true,
    created_at: demoCreatedAt,
  },
];

export const demoTripData: TripData = {
  trip: demoTrip,
  days: demoDays,
  routeSegments: demoRoutes,
  photos: demoPhotos,
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
