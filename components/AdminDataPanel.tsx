"use client";

import { CalendarDays, Camera, FileText, Loader2, MapPin, Pencil, Route, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Day, Note, Photo, Place, RouteMode, RouteSegment, Trip } from "@/types/trip";

type TripUpdate = {
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
};

type DayUpdate = {
  day_number: number;
  date: string | null;
  title: string | null;
  summary: string | null;
};

type RouteUpdate = {
  day_id: string | null;
  name: string | null;
  mode: RouteMode;
  source: string | null;
};

type NoteUpdate = {
  day_id: string | null;
  author_name: string | null;
  body: string;
};

type PlaceUpdate = {
  day_id: string | null;
  name: string;
  place_type: string | null;
  description: string | null;
  lat: number;
  lng: number;
};

type PhotoUpdate = {
  day_id: string | null;
  uploader_name: string | null;
  caption: string | null;
  lat: number | null;
  lng: number | null;
  taken_at: string | null;
};

export type AdminDataProps = {
  trip: Trip | null;
  days: Day[];
  routes: RouteSegment[];
  notes: Note[];
  places: Place[];
  photos: Photo[];
  message: string | null;
  messageTone: "info" | "error";
  isSaving: boolean;
  onUpdateTrip: (input: TripUpdate) => Promise<void>;
  onCreateDay: (input: DayUpdate) => Promise<void>;
  onUpdateDay: (dayId: string, input: DayUpdate) => Promise<void>;
  onUpdateRoute: (routeId: string, input: RouteUpdate) => Promise<void>;
  onUpdateNote: (noteId: string, input: NoteUpdate) => Promise<void>;
  onUpdatePlace: (placeId: string, input: PlaceUpdate) => Promise<void>;
  onUpdatePhoto: (photoId: string, input: PhotoUpdate) => Promise<void>;
  onDeleteItem: (table: "days" | "route_segments" | "notes" | "places" | "photos", id: string) => Promise<void>;
};

const routeModes: Array<{ value: RouteMode; label: string }> = [
  { value: "hike", label: "Hike" },
  { value: "walk", label: "Walk" },
  { value: "ferry", label: "Ferry" },
  { value: "bus", label: "Bus" },
  { value: "other", label: "Other" },
];

function optionalString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

function optionalDate(formData: FormData, key: string) {
  return String(formData.get(key) ?? "") || null;
}

function optionalNumber(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function datetimeLocalValue(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function optionalDateTime(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dayOptions(days: Day[]) {
  return (
    <>
      <option value="">All days</option>
      {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
    </>
  );
}

function keyPart(value: string | number | null | undefined) {
  return value ?? "";
}

function tripFormKey(trip: Trip) {
  return ["trip", trip.id, trip.title, keyPart(trip.description), keyPart(trip.start_date), keyPart(trip.end_date)].join("|");
}

function newDayEditorKey(days: Day[]) {
  return days.map((day) => `${day.id}:${day.day_number}`).join("|") || "empty";
}

function dayEditorKey(day: Day) {
  return ["day", day.id, day.day_number, keyPart(day.date), keyPart(day.title), keyPart(day.summary)].join("|");
}

function routeEditorKey(route: RouteSegment) {
  return ["route", route.id, keyPart(route.day_id), keyPart(route.name), route.mode, keyPart(route.source)].join("|");
}

function noteEditorKey(note: Note) {
  return ["note", note.id, keyPart(note.day_id), keyPart(note.author_name), note.body].join("|");
}

function placeEditorKey(place: Place) {
  return [
    "place",
    place.id,
    keyPart(place.day_id),
    place.name,
    keyPart(place.place_type),
    keyPart(place.description),
    place.lat,
    place.lng,
  ].join("|");
}

function photoEditorKey(photo: Photo) {
  return [
    "photo",
    photo.id,
    keyPart(photo.day_id),
    keyPart(photo.uploader_name),
    keyPart(photo.caption),
    keyPart(photo.lat),
    keyPart(photo.lng),
    keyPart(photo.taken_at),
    keyPart(photo.thumbnail_url),
    photo.image_url,
  ].join("|");
}

function dayDeleteMessage(day: Day) {
  const label = `Day ${day.day_number}${day.title ? `: ${day.title}` : ""}`;
  return `Delete ${label}? Photos, notes, places, and routes assigned to this day will stay in the trip and move to All days.`;
}

function routeLabel(route: RouteSegment) {
  return route.name || `${route.mode} route`;
}

function noteLabel(note: Note) {
  return note.body.length > 42 ? `${note.body.slice(0, 42)}...` : note.body;
}

function placeLabel(place: Place) {
  return place.name || "this place";
}

function photoLabel(photo: Photo) {
  if (photo.caption) return photo.caption.length > 42 ? `${photo.caption.slice(0, 42)}...` : photo.caption;
  if (photo.taken_at) return `photo from ${new Date(photo.taken_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return "this photo";
}

export function AdminDataPanel(props: AdminDataProps) {
  async function submitTrip(formData: FormData) {
    await props.onUpdateTrip({
      title: String(formData.get("title") ?? "").trim() || props.trip?.title || "Trip Logbook",
      description: optionalString(formData, "description"),
      start_date: optionalDate(formData, "start_date"),
      end_date: optionalDate(formData, "end_date"),
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white/75 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-stone-900"><Pencil className="h-4 w-4 text-teal-700" /> Admin data</div>
      {props.message ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs leading-5",
            props.messageTone === "error" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-teal-700/15 bg-teal-50 text-teal-950",
          )}
        >
          {props.message}
        </div>
      ) : null}

      {props.trip ? (
        <details className="group rounded-lg bg-[#f7f1e7] p-3">
          <summary className="cursor-pointer text-sm font-bold text-stone-900">Trip</summary>
          <form key={tripFormKey(props.trip)} action={submitTrip} className="mt-3 space-y-2">
            <input name="title" defaultValue={props.trip.title} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
            <textarea name="description" defaultValue={props.trip.description ?? ""} placeholder="Description" className="min-h-20 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
            <div className="grid grid-cols-2 gap-2">
              <input name="start_date" type="date" defaultValue={props.trip.start_date ?? ""} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
              <input name="end_date" type="date" defaultValue={props.trip.end_date ?? ""} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
            </div>
            <SaveButton isSaving={props.isSaving}>Save trip</SaveButton>
          </form>
        </details>
      ) : null}

      <details className="rounded-lg bg-[#f7f1e7] p-3">
        <summary className="cursor-pointer text-sm font-bold text-stone-900"><CalendarDays className="mr-2 inline h-4 w-4 text-teal-700" />Days</summary>
        <div className="mt-3 space-y-3">
          <NewDayEditor key={newDayEditorKey(props.days)} days={props.days} isSaving={props.isSaving} onCreate={props.onCreateDay} />
          {props.days.map((day) => <DayEditor key={dayEditorKey(day)} day={day} isSaving={props.isSaving} onSave={props.onUpdateDay} onDelete={() => props.onDeleteItem("days", day.id)} />)}
        </div>
      </details>

      <details className="rounded-lg bg-[#f7f1e7] p-3">
        <summary className="cursor-pointer text-sm font-bold text-stone-900"><Route className="mr-2 inline h-4 w-4 text-teal-700" />Routes</summary>
        <div className="mt-3 space-y-3">
          {props.routes.length === 0 ? <EmptyRow label="No routes yet" /> : props.routes.map((route) => (
            <RouteEditor key={routeEditorKey(route)} route={route} days={props.days} isSaving={props.isSaving} onSave={props.onUpdateRoute} onDelete={() => props.onDeleteItem("route_segments", route.id)} />
          ))}
        </div>
      </details>

      <details className="rounded-lg bg-[#f7f1e7] p-3">
        <summary className="cursor-pointer text-sm font-bold text-stone-900"><FileText className="mr-2 inline h-4 w-4 text-teal-700" />Notes & places</summary>
        <div className="mt-3 space-y-3">
          {props.notes.map((note) => <NoteEditor key={noteEditorKey(note)} note={note} days={props.days} isSaving={props.isSaving} onSave={props.onUpdateNote} onDelete={() => props.onDeleteItem("notes", note.id)} />)}
          {props.places.map((place) => <PlaceEditor key={placeEditorKey(place)} place={place} days={props.days} isSaving={props.isSaving} onSave={props.onUpdatePlace} onDelete={() => props.onDeleteItem("places", place.id)} />)}
          {props.notes.length === 0 && props.places.length === 0 ? <EmptyRow label="No notes or places yet" /> : null}
        </div>
      </details>

      <details className="rounded-lg bg-[#f7f1e7] p-3">
        <summary className="cursor-pointer text-sm font-bold text-stone-900"><Camera className="mr-2 inline h-4 w-4 text-teal-700" />Photos</summary>
        <div className="mt-3 space-y-3">
          {props.photos.length === 0 ? <EmptyRow label="No photos yet" /> : props.photos.map((photo) => (
            <PhotoEditor key={photoEditorKey(photo)} photo={photo} days={props.days} isSaving={props.isSaving} onSave={props.onUpdatePhoto} onDelete={() => props.onDeleteItem("photos", photo.id)} />
          ))}
        </div>
      </details>
    </section>
  );
}

function NewDayEditor({ days, isSaving, onCreate }: { days: Day[]; isSaving: boolean; onCreate: AdminDataProps["onCreateDay"] }) {
  const nextDayNumber = Math.max(0, ...days.map((day) => day.day_number)) + 1;

  async function submit(formData: FormData) {
    await onCreate({
      day_number: Number(formData.get("day_number") || nextDayNumber),
      date: optionalDate(formData, "date"),
      title: optionalString(formData, "title"),
      summary: optionalString(formData, "summary"),
    });
  }

  return (
    <form action={submit} className="space-y-2 rounded-lg border border-teal-700/20 bg-teal-50 p-2">
      <div className="text-xs font-bold uppercase tracking-[0.08em] text-teal-900">Add day</div>
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <input name="day_number" type="number" min="1" defaultValue={nextDayNumber} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
        <input name="date" type="date" className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      </div>
      <input name="title" placeholder="Day title" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <textarea name="summary" placeholder="Summary" className="min-h-14 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <SaveButton isSaving={isSaving}>Add day</SaveButton>
    </form>
  );
}

function DayEditor({ day, isSaving, onSave, onDelete }: { day: Day; isSaving: boolean; onSave: AdminDataProps["onUpdateDay"]; onDelete: () => Promise<void> }) {
  async function submit(formData: FormData) {
    await onSave(day.id, {
      day_number: Number(formData.get("day_number") || day.day_number),
      date: optionalDate(formData, "date"),
      title: optionalString(formData, "title"),
      summary: optionalString(formData, "summary"),
    });
  }

  return (
    <form action={submit} className="space-y-2 rounded-lg border border-stone-200 bg-white p-2">
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <input name="day_number" type="number" min="1" defaultValue={day.day_number} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
        <input name="date" type="date" defaultValue={day.date ?? ""} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      </div>
      <input name="title" defaultValue={day.title ?? ""} placeholder="Day title" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <textarea name="summary" defaultValue={day.summary ?? ""} placeholder="Summary" className="min-h-16 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <EditorActions isSaving={isSaving} saveLabel="Save day" deleteLabel="Delete day" deleteConfirmMessage={dayDeleteMessage(day)} onDelete={onDelete} />
    </form>
  );
}

export function RouteEditor({ route, days, isSaving, onSave, onDelete }: { route: RouteSegment; days: Day[]; isSaving: boolean; onSave: AdminDataProps["onUpdateRoute"]; onDelete: () => Promise<void> }) {
  async function submit(formData: FormData) {
    await onSave(route.id, {
      day_id: String(formData.get("day_id") || "") || null,
      name: optionalString(formData, "name"),
      mode: String(formData.get("mode") || route.mode) as RouteMode,
      source: optionalString(formData, "source"),
    });
  }

  return (
    <form action={submit} className="space-y-2 rounded-lg border border-stone-200 bg-white p-2">
      <input name="name" defaultValue={route.name ?? ""} placeholder="Route name" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <div className="grid grid-cols-2 gap-2">
        <select name="day_id" defaultValue={route.day_id ?? ""} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">{dayOptions(days)}</select>
        <select name="mode" defaultValue={route.mode} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
          {routeModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
        </select>
      </div>
      <input name="source" defaultValue={route.source ?? ""} placeholder="Source" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <EditorActions isSaving={isSaving} saveLabel="Save route" deleteLabel="Delete route" deleteConfirmMessage={`Delete route "${routeLabel(route)}"?`} onDelete={onDelete} />
    </form>
  );
}

export function NoteEditor({ note, days, isSaving, onSave, onDelete }: { note: Note; days: Day[]; isSaving: boolean; onSave: AdminDataProps["onUpdateNote"]; onDelete: () => Promise<void> }) {
  async function submit(formData: FormData) {
    await onSave(note.id, {
      day_id: String(formData.get("day_id") || "") || null,
      author_name: optionalString(formData, "author_name"),
      body: String(formData.get("body") ?? "").trim() || note.body,
    });
  }

  return (
    <form action={submit} className="space-y-2 rounded-lg border border-stone-200 bg-white p-2">
      <select name="day_id" defaultValue={note.day_id ?? ""} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">{dayOptions(days)}</select>
      <input name="author_name" defaultValue={note.author_name ?? ""} placeholder="Author" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <textarea name="body" defaultValue={note.body} className="min-h-16 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <EditorActions isSaving={isSaving} saveLabel="Save note" deleteLabel="Delete note" deleteConfirmMessage={`Delete note "${noteLabel(note)}"?`} onDelete={onDelete} />
    </form>
  );
}

export function PlaceEditor({ place, days, isSaving, onSave, onDelete }: { place: Place; days: Day[]; isSaving: boolean; onSave: AdminDataProps["onUpdatePlace"]; onDelete: () => Promise<void> }) {
  async function submit(formData: FormData) {
    await onSave(place.id, {
      day_id: String(formData.get("day_id") || "") || null,
      name: String(formData.get("name") ?? "").trim() || place.name,
      place_type: optionalString(formData, "place_type"),
      description: optionalString(formData, "description"),
      lat: Number(formData.get("lat") || place.lat),
      lng: Number(formData.get("lng") || place.lng),
    });
  }

  return (
    <form action={submit} className="space-y-2 rounded-lg border border-stone-200 bg-white p-2">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-stone-500"><MapPin className="h-3.5 w-3.5 text-teal-700" /> Place</div>
      <input name="name" defaultValue={place.name} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <select name="day_id" defaultValue={place.day_id ?? ""} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">{dayOptions(days)}</select>
      <div className="grid grid-cols-2 gap-2">
        <input name="lat" type="number" step="any" defaultValue={place.lat} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
        <input name="lng" type="number" step="any" defaultValue={place.lng} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      </div>
      <input name="place_type" defaultValue={place.place_type ?? ""} placeholder="Type" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <textarea name="description" defaultValue={place.description ?? ""} placeholder="Description" className="min-h-16 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
      <EditorActions isSaving={isSaving} saveLabel="Save place" deleteLabel="Delete place" deleteConfirmMessage={`Delete place "${placeLabel(place)}"?`} onDelete={onDelete} />
    </form>
  );
}

export function PhotoEditor({ photo, days, isSaving, onSave, onDelete }: { photo: Photo; days: Day[]; isSaving: boolean; onSave: AdminDataProps["onUpdatePhoto"]; onDelete: () => Promise<void> }) {
  async function submit(formData: FormData) {
    await onSave(photo.id, {
      day_id: String(formData.get("day_id") || "") || null,
      uploader_name: optionalString(formData, "uploader_name"),
      caption: optionalString(formData, "caption"),
      lat: optionalNumber(formData, "lat"),
      lng: optionalNumber(formData, "lng"),
      taken_at: optionalDateTime(formData, "taken_at"),
    });
  }

  return (
    <form action={submit} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2 rounded-lg border border-stone-200 bg-white p-2">
      <div className="h-16 overflow-hidden rounded-md bg-stone-100">
        {/* eslint-disable-next-line @next/next/no-img-element -- Existing remote URLs come from user uploads. */}
        <img src={photo.thumbnail_url ?? photo.image_url} alt="" className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 space-y-2">
        <select name="day_id" defaultValue={photo.day_id ?? ""} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">{dayOptions(days)}</select>
        <input name="uploader_name" defaultValue={photo.uploader_name ?? ""} placeholder="Uploader" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-[11px] font-bold uppercase tracking-[0.08em] text-stone-500">
            Latitude
            <input name="lat" type="number" step="any" defaultValue={photo.lat ?? ""} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-normal tracking-normal text-stone-950 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
          </label>
          <label className="space-y-1 text-[11px] font-bold uppercase tracking-[0.08em] text-stone-500">
            Longitude
            <input name="lng" type="number" step="any" defaultValue={photo.lng ?? ""} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-normal tracking-normal text-stone-950 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
          </label>
        </div>
        <label className="block space-y-1 text-[11px] font-bold uppercase tracking-[0.08em] text-stone-500">
          Taken time
          <input name="taken_at" type="datetime-local" defaultValue={datetimeLocalValue(photo.taken_at)} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-normal tracking-normal text-stone-950 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
        </label>
        <textarea name="caption" defaultValue={photo.caption ?? ""} placeholder="Caption" className="min-h-14 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
        <EditorActions isSaving={isSaving} saveLabel="Save photo" deleteLabel="Delete photo" deleteConfirmMessage={`Delete ${photoLabel(photo)}? The uploaded image file will also be removed when storage cleanup succeeds.`} onDelete={onDelete} />
      </div>
    </form>
  );
}

function EditorActions({ isSaving, saveLabel, deleteLabel, deleteConfirmMessage, onDelete }: { isSaving: boolean; saveLabel: string; deleteLabel: string; deleteConfirmMessage: string; onDelete: () => Promise<void> }) {
  async function deleteItem() {
    if (window.confirm(deleteConfirmMessage)) await onDelete();
  }

  return (
    <div className="grid grid-cols-[1fr_auto] gap-2">
      <SaveButton isSaving={isSaving}>{saveLabel}</SaveButton>
      <button type="button" onClick={deleteItem} disabled={isSaving} className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-rose-700 transition hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-200/70 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50" aria-label={deleteLabel} title={deleteLabel}>
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function SaveButton({ children, isSaving }: { children: string; isSaving: boolean }) {
  return (
    <button disabled={isSaving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 py-2.5 text-sm font-black text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {children}
    </button>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-500">{label}</div>;
}
