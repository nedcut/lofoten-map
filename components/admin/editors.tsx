"use client";

import { Loader2, MapPin, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import type { Day, Note, Photo, Place, RouteMode, RouteSegment, Trip } from "@/types/trip";

// The per-row admin edit forms (days, routes, notes, places, photos) plus the
// FormData helpers and remount keys they share. AdminDataPanel composes these
// into sections; EditItemPanel reuses the editors for single-item editing
// from a map popup.

export type TripUpdate = {
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type DayUpdate = {
  day_number: number;
  date: string | null;
  title: string | null;
  summary: string | null;
};

export type RouteUpdate = {
  day_id: string | null;
  name: string | null;
  mode: RouteMode;
  source: string | null;
};

export type NoteUpdate = {
  day_id: string | null;
  author_name: string | null;
  body: string;
};

export type PlaceUpdate = {
  day_id: string | null;
  name: string;
  place_type: string | null;
  description: string | null;
  lat: number;
  lng: number;
};

export type PhotoUpdate = {
  day_id: string | null;
  uploader_name: string | null;
  caption: string | null;
  lat: number | null;
  lng: number | null;
  taken_at: string | null;
};

const routeModes: Array<{ value: RouteMode; label: string }> = [
  { value: "hike", label: "Hike" },
  { value: "walk", label: "Walk" },
  { value: "ferry", label: "Ferry" },
  { value: "bus", label: "Bus" },
  { value: "other", label: "Other" },
];

export function optionalString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim() || null;
}

export function optionalDate(formData: FormData, key: string) {
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

// Remount keys: the editors are uncontrolled forms (defaultValue), so a row
// must remount when its server-side values change or stale edits would stick.
export function tripFormKey(trip: Trip) {
  return ["trip", trip.id, trip.title, keyPart(trip.description), keyPart(trip.start_date), keyPart(trip.end_date)].join("|");
}

export function newDayEditorKey(days: Day[]) {
  return days.map((day) => `${day.id}:${day.day_number}`).join("|") || "empty";
}

export function dayEditorKey(day: Day) {
  return ["day", day.id, day.day_number, keyPart(day.date), keyPart(day.title), keyPart(day.summary)].join("|");
}

export function routeEditorKey(route: RouteSegment) {
  return ["route", route.id, keyPart(route.day_id), keyPart(route.name), route.mode, keyPart(route.source)].join("|");
}

export function noteEditorKey(note: Note) {
  return ["note", note.id, keyPart(note.day_id), keyPart(note.author_name), note.body].join("|");
}

export function placeEditorKey(place: Place) {
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

export function photoEditorKey(photo: Photo) {
  return [
    "photo",
    photo.id,
    keyPart(photo.day_id),
    keyPart(photo.uploader_name),
    keyPart(photo.caption),
    keyPart(photo.lat),
    keyPart(photo.lng),
    keyPart(photo.taken_at),
    // Key off stable storage paths, not derived public URLs, so URL resolution
    // cannot remount the edit form.
    keyPart(photo.thumbnail_path),
    photo.image_path,
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

export function photoLabel(photo: Photo) {
  if (photo.caption) return photo.caption.length > 42 ? `${photo.caption.slice(0, 42)}...` : photo.caption;
  if (photo.taken_at) return `photo from ${new Date(photo.taken_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return "this photo";
}

export function NewDayEditor({ days, isSaving, onCreate }: { days: Day[]; isSaving: boolean; onCreate: (input: DayUpdate) => Promise<void> }) {
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
    <form action={submit} className="space-y-2 rounded-[var(--radius-control)] border border-teal-700/20 bg-teal-50 p-2">
      <div className="text-xs font-bold uppercase tracking-[0.08em] text-teal-900">Add day</div>
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <Field label="Day number" hideLabel><Input name="day_number" type="number" min="1" defaultValue={nextDayNumber} /></Field>
        <Field label="Date" hideLabel><Input name="date" type="date" /></Field>
      </div>
      <Field label="Day title" hideLabel><Input name="title" placeholder="Day title" /></Field>
      <Field label="Summary" hideLabel><Textarea name="summary" placeholder="Summary" className="min-h-14" /></Field>
      <SaveButton isSaving={isSaving}>Add day</SaveButton>
    </form>
  );
}

export function DayEditor({ day, isSaving, onSave, onDelete }: { day: Day; isSaving: boolean; onSave: (dayId: string, input: DayUpdate) => Promise<void>; onDelete: () => Promise<void> }) {
  async function submit(formData: FormData) {
    await onSave(day.id, {
      day_number: Number(formData.get("day_number") || day.day_number),
      date: optionalDate(formData, "date"),
      title: optionalString(formData, "title"),
      summary: optionalString(formData, "summary"),
    });
  }

  return (
    <form action={submit} className="space-y-2 rounded-[var(--radius-control)] border border-stone-200 bg-white p-2">
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <Field label="Day number" hideLabel><Input name="day_number" type="number" min="1" defaultValue={day.day_number} /></Field>
        <Field label="Date" hideLabel><Input name="date" type="date" defaultValue={day.date ?? ""} /></Field>
      </div>
      <Field label="Day title" hideLabel><Input name="title" defaultValue={day.title ?? ""} placeholder="Day title" /></Field>
      <Field label="Summary" hideLabel><Textarea name="summary" defaultValue={day.summary ?? ""} placeholder="Summary" className="min-h-16" /></Field>
      <EditorActions isSaving={isSaving} saveLabel="Save day" deleteLabel="Delete day" deleteConfirmMessage={dayDeleteMessage(day)} onDelete={onDelete} />
    </form>
  );
}

export function RouteEditor({ route, days, isSaving, onSave, onDelete }: { route: RouteSegment; days: Day[]; isSaving: boolean; onSave: (routeId: string, input: RouteUpdate) => Promise<void>; onDelete: () => Promise<void> }) {
  async function submit(formData: FormData) {
    await onSave(route.id, {
      day_id: String(formData.get("day_id") || "") || null,
      name: optionalString(formData, "name"),
      mode: String(formData.get("mode") || route.mode) as RouteMode,
      source: optionalString(formData, "source"),
    });
  }

  return (
    <form action={submit} className="space-y-2 rounded-[var(--radius-control)] border border-stone-200 bg-white p-2">
      <Field label="Route name" hideLabel><Input name="name" defaultValue={route.name ?? ""} placeholder="Route name" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Day" hideLabel><Select name="day_id" defaultValue={route.day_id ?? ""}>{dayOptions(days)}</Select></Field>
        <Field label="Mode" hideLabel>
          <Select name="mode" defaultValue={route.mode}>
            {routeModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Source" hideLabel><Input name="source" defaultValue={route.source ?? ""} placeholder="Source" /></Field>
      <EditorActions isSaving={isSaving} saveLabel="Save route" deleteLabel="Delete route" deleteConfirmMessage={`Delete route "${routeLabel(route)}"?`} onDelete={onDelete} />
    </form>
  );
}

export function NoteEditor({ note, days, isSaving, onSave, onDelete }: { note: Note; days: Day[]; isSaving: boolean; onSave: (noteId: string, input: NoteUpdate) => Promise<void>; onDelete: () => Promise<void> }) {
  async function submit(formData: FormData) {
    await onSave(note.id, {
      day_id: String(formData.get("day_id") || "") || null,
      author_name: optionalString(formData, "author_name"),
      body: String(formData.get("body") ?? "").trim() || note.body,
    });
  }

  return (
    <form action={submit} className="space-y-2 rounded-[var(--radius-control)] border border-stone-200 bg-white p-2">
      <Field label="Day" hideLabel><Select name="day_id" defaultValue={note.day_id ?? ""}>{dayOptions(days)}</Select></Field>
      <Field label="Author" hideLabel><Input name="author_name" defaultValue={note.author_name ?? ""} placeholder="Author" /></Field>
      <Field label="Note" hideLabel><Textarea name="body" defaultValue={note.body} className="min-h-16" /></Field>
      <EditorActions isSaving={isSaving} saveLabel="Save note" deleteLabel="Delete note" deleteConfirmMessage={`Delete note "${noteLabel(note)}"?`} onDelete={onDelete} />
    </form>
  );
}

export function PlaceEditor({ place, days, isSaving, onSave, onDelete }: { place: Place; days: Day[]; isSaving: boolean; onSave: (placeId: string, input: PlaceUpdate) => Promise<void>; onDelete: () => Promise<void> }) {
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
    <form action={submit} className="space-y-2 rounded-[var(--radius-control)] border border-stone-200 bg-white p-2">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-stone-500"><MapPin className="h-3.5 w-3.5 text-teal-700" /> Place</div>
      <Field label="Name" hideLabel><Input name="name" defaultValue={place.name} /></Field>
      <Field label="Day" hideLabel><Select name="day_id" defaultValue={place.day_id ?? ""}>{dayOptions(days)}</Select></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Latitude" hideLabel><Input name="lat" type="number" step="any" defaultValue={place.lat} /></Field>
        <Field label="Longitude" hideLabel><Input name="lng" type="number" step="any" defaultValue={place.lng} /></Field>
      </div>
      <Field label="Type" hideLabel><Input name="place_type" defaultValue={place.place_type ?? ""} placeholder="Type" /></Field>
      <Field label="Description" hideLabel><Textarea name="description" defaultValue={place.description ?? ""} placeholder="Description" className="min-h-16" /></Field>
      <EditorActions isSaving={isSaving} saveLabel="Save place" deleteLabel="Delete place" deleteConfirmMessage={`Delete place "${placeLabel(place)}"?`} onDelete={onDelete} />
    </form>
  );
}

export function PhotoEditor({ photo, days, isSaving, onSave, onDelete }: { photo: Photo; days: Day[]; isSaving: boolean; onSave: (photoId: string, input: PhotoUpdate) => Promise<void>; onDelete: () => Promise<void> }) {
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
    <form action={submit} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2 rounded-[var(--radius-control)] border border-stone-200 bg-white p-2">
      <div className="h-16 overflow-hidden rounded-md bg-stone-100">
        {photo.thumbnail_url || photo.image_url
          // eslint-disable-next-line @next/next/no-img-element -- Existing remote URLs come from user uploads.
          ? <img src={photo.thumbnail_url ?? photo.image_url ?? ""} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          : <div className="flex h-full items-center justify-center text-xs font-bold text-stone-500">{photo.media_type === "video" ? "Video" : "Photo"}</div>}
      </div>
      <div className="min-w-0 space-y-2">
        <Field label="Day" hideLabel><Select name="day_id" defaultValue={photo.day_id ?? ""}>{dayOptions(days)}</Select></Field>
        <Field label="Uploader" hideLabel><Input name="uploader_name" defaultValue={photo.uploader_name ?? ""} placeholder="Uploader" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude"><Input name="lat" type="number" step="any" defaultValue={photo.lat ?? ""} /></Field>
          <Field label="Longitude"><Input name="lng" type="number" step="any" defaultValue={photo.lng ?? ""} /></Field>
        </div>
        <Field label="Taken time"><Input name="taken_at" type="datetime-local" defaultValue={datetimeLocalValue(photo.taken_at)} /></Field>
        <Field label="Caption" hideLabel><Textarea name="caption" defaultValue={photo.caption ?? ""} placeholder="Caption" className="min-h-14" /></Field>
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
      <Button type="button" variant="danger" onClick={deleteItem} disabled={isSaving} className="px-3" aria-label={deleteLabel} title={deleteLabel}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function SaveButton({ children, isSaving }: { children: string; isSaving: boolean }) {
  return (
    <Button type="submit" tone="fjord" size="sm" disabled={isSaving} className="w-full">
      {isSaving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Save className="h-4 w-4" />} {children}
    </Button>
  );
}

export function EmptyRow({ label }: { label: string }) {
  return <div className="rounded-[var(--radius-control)] border border-stone-200 bg-white px-3 py-2 text-xs text-stone-500">{label}</div>;
}
