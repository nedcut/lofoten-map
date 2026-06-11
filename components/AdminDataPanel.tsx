"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, Camera, FileText, Loader2, Pencil, Route, Upload } from "lucide-react";
import {
  type DayUpdate,
  type NoteUpdate,
  type PhotoUpdate,
  type PlaceUpdate,
  type RouteUpdate,
  type TripUpdate,
  DayEditor,
  EmptyRow,
  NewDayEditor,
  NoteEditor,
  PhotoEditor,
  PlaceEditor,
  RouteEditor,
  SaveButton,
  dayEditorKey,
  newDayEditorKey,
  noteEditorKey,
  optionalDate,
  optionalString,
  photoEditorKey,
  placeEditorKey,
  routeEditorKey,
  tripFormKey,
} from "@/components/admin/editors";
import { LocationCheckList } from "@/components/admin/LocationCheck";
import { cn } from "@/lib/utils";
import { detectPhotoOutliers, type PhotoOutlier } from "@/lib/photo-outliers";
import type { Day, Note, Photo, Place, RouteSegment, Trip } from "@/types/trip";

// Re-exported so existing importers (EditItemPanel) keep one canonical path.
export { NoteEditor, PhotoEditor, PlaceEditor, RouteEditor, noteEditorKey, photoEditorKey, placeEditorKey, routeEditorKey };

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
  onImportGpx: (file: File) => Promise<void>;
  // Show a location-check outlier on the map (null clears). focus also fits
  // the map around the photo and its group.
  onPreviewOutlier: (outlier: PhotoOutlier | null, options?: { focus?: boolean }) => void;
};

const PHOTO_PAGE_SIZE = 24;

// A closed <details> still mounts its children and fetches their images, so
// with hundreds of photo editors the collapsed panel was nearly as expensive
// as an open one. Defer rendering the body until the section is first opened.
function LazyDetails({ summary, className, children }: { summary: ReactNode; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={cn("rounded-lg bg-[#f7f1e7] p-3", className)} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-bold text-stone-900">{summary}</summary>
      {open ? children : null}
    </details>
  );
}

function PhotoList({ photos, days, isSaving, onSave, onDeleteItem }: Pick<AdminDataProps, "photos" | "days" | "isSaving"> & { onSave: AdminDataProps["onUpdatePhoto"]; onDeleteItem: AdminDataProps["onDeleteItem"] }) {
  const [visibleCount, setVisibleCount] = useState(PHOTO_PAGE_SIZE);
  if (photos.length === 0) return <EmptyRow label="No media yet" />;
  return (
    <>
      {photos.slice(0, visibleCount).map((photo) => (
        <PhotoEditor key={photoEditorKey(photo)} photo={photo} days={days} isSaving={isSaving} onSave={onSave} onDelete={() => onDeleteItem("photos", photo.id)} />
      ))}
      {photos.length > visibleCount ? (
        <button type="button" onClick={() => setVisibleCount((current) => current + PHOTO_PAGE_SIZE)} className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-700 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50">
          Show {Math.min(PHOTO_PAGE_SIZE, photos.length - visibleCount)} more of {photos.length - visibleCount} remaining
        </button>
      ) : null}
    </>
  );
}

export function AdminDataPanel(props: AdminDataProps) {
  // Photos far from where their time-neighbors were taken — usually a wrong
  // manual placement. Dismissals live for the session only; a photo that is
  // genuinely fine will simply reappear next visit and can be dismissed again
  // (or moved, which removes it from the list for good).
  const outliers = useMemo(() => detectPhotoOutliers(props.photos), [props.photos]);
  const [dismissedOutliers, setDismissedOutliers] = useState<ReadonlySet<string>>(new Set());
  const visibleOutliers = outliers.filter((outlier) => !dismissedOutliers.has(outlier.photo.id));

  async function moveOutlier(outlier: PhotoOutlier) {
    const { photo, suggested } = outlier;
    await props.onUpdatePhoto(photo.id, {
      day_id: photo.day_id,
      uploader_name: photo.uploader_name,
      caption: photo.caption,
      lat: suggested.lat,
      lng: suggested.lng,
      taken_at: photo.taken_at,
    });
  }

  async function submitTrip(formData: FormData) {
    await props.onUpdateTrip({
      title: String(formData.get("title") ?? "").trim() || props.trip?.title || "Trip Logbook",
      description: optionalString(formData, "description"),
      start_date: optionalDate(formData, "start_date"),
      end_date: optionalDate(formData, "end_date"),
    });
  }

  async function submitGpxImport(formData: FormData) {
    const file = formData.get("gpx");
    if (file instanceof File && file.size > 0) await props.onImportGpx(file);
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
        <LazyDetails className="group" summary="Trip">
          <form key={tripFormKey(props.trip)} action={submitTrip} className="mt-3 space-y-2">
            <input name="title" defaultValue={props.trip.title} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
            <textarea name="description" defaultValue={props.trip.description ?? ""} placeholder="Description" className="min-h-20 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
            <div className="grid grid-cols-2 gap-2">
              <input name="start_date" type="date" defaultValue={props.trip.start_date ?? ""} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
              <input name="end_date" type="date" defaultValue={props.trip.end_date ?? ""} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
            </div>
            <SaveButton isSaving={props.isSaving}>Save trip</SaveButton>
          </form>
        </LazyDetails>
      ) : null}

      <LazyDetails summary={<><CalendarDays className="mr-2 inline h-4 w-4 text-teal-700" />Days</>}>
        <div className="mt-3 space-y-3">
          <NewDayEditor key={newDayEditorKey(props.days)} days={props.days} isSaving={props.isSaving} onCreate={props.onCreateDay} />
          {props.days.map((day) => <DayEditor key={dayEditorKey(day)} day={day} isSaving={props.isSaving} onSave={props.onUpdateDay} onDelete={() => props.onDeleteItem("days", day.id)} />)}
        </div>
      </LazyDetails>

      <LazyDetails summary={<><Route className="mr-2 inline h-4 w-4 text-teal-700" />Routes</>}>
        <div className="mt-3 space-y-3">
          <form action={submitGpxImport} className="space-y-2 rounded-lg border border-teal-700/20 bg-teal-50 p-2">
            <label className="block space-y-1 text-[11px] font-bold uppercase tracking-[0.08em] text-teal-900">
              GPX file
              <input name="gpx" type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" disabled={props.isSaving} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-normal tracking-normal text-stone-950 file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-stone-700 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15 disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
            <button disabled={props.isSaving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 py-2.5 text-sm font-black text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
              {props.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import GPX
            </button>
          </form>
          {props.routes.length === 0 ? <EmptyRow label="No routes yet" /> : props.routes.map((route) => (
            <RouteEditor key={routeEditorKey(route)} route={route} days={props.days} isSaving={props.isSaving} onSave={props.onUpdateRoute} onDelete={() => props.onDeleteItem("route_segments", route.id)} />
          ))}
        </div>
      </LazyDetails>

      <LazyDetails summary={<><FileText className="mr-2 inline h-4 w-4 text-teal-700" />Notes & places</>}>
        <div className="mt-3 space-y-3">
          {props.notes.map((note) => <NoteEditor key={noteEditorKey(note)} note={note} days={props.days} isSaving={props.isSaving} onSave={props.onUpdateNote} onDelete={() => props.onDeleteItem("notes", note.id)} />)}
          {props.places.map((place) => <PlaceEditor key={placeEditorKey(place)} place={place} days={props.days} isSaving={props.isSaving} onSave={props.onUpdatePlace} onDelete={() => props.onDeleteItem("places", place.id)} />)}
          {props.notes.length === 0 && props.places.length === 0 ? <EmptyRow label="No notes or places yet" /> : null}
        </div>
      </LazyDetails>

      <LazyDetails summary={<><Camera className="mr-2 inline h-4 w-4 text-teal-700" />Media ({props.photos.length})</>}>
        <div className="mt-3 space-y-3">
          <PhotoList photos={props.photos} days={props.days} isSaving={props.isSaving} onSave={props.onUpdatePhoto} onDeleteItem={props.onDeleteItem} />
        </div>
      </LazyDetails>

      <LazyDetails summary={<><AlertTriangle className={cn("mr-2 inline h-4 w-4", visibleOutliers.length > 0 ? "text-amber-600" : "text-teal-700")} />Location check ({visibleOutliers.length})</>}>
        <div className="mt-3 space-y-2">
          <p className="text-xs leading-5 text-stone-600">
            Photos taken around the same time are usually taken near each other. These sit far from their time-neighbors — likely misplaced. Moving snaps the photo to the middle of its group.
          </p>
          {visibleOutliers.length === 0 ? (
            <EmptyRow label="No suspect locations found" />
          ) : (
            <LocationCheckList
              outliers={visibleOutliers}
              isSaving={props.isSaving}
              onMove={moveOutlier}
              onDismiss={(outlier) => setDismissedOutliers((current) => new Set([...current, outlier.photo.id]))}
              onPreview={props.onPreviewOutlier}
            />
          )}
        </div>
      </LazyDetails>
    </section>
  );
}
