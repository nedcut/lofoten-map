"use client";

import { X } from "lucide-react";
import { NoteEditor, PhotoEditor, PlaceEditor, RouteEditor, type AdminDataProps } from "@/components/AdminDataPanel";
import type { Day, Note, Photo, Place, RouteSegment } from "@/types/trip";

// A single resolved map item the user picked from a popup. Discriminated so the
// panel can render the matching editor with the right typed handlers.
export type EditTarget =
  | { kind: "photo"; item: Photo }
  | { kind: "note"; item: Note }
  | { kind: "place"; item: Place }
  | { kind: "route"; item: RouteSegment };

type Props = {
  target: EditTarget;
  days: Day[];
  isSaving: boolean;
  onClose: () => void;
  onUpdatePhoto: AdminDataProps["onUpdatePhoto"];
  onUpdateNote: AdminDataProps["onUpdateNote"];
  onUpdatePlace: AdminDataProps["onUpdatePlace"];
  onUpdateRoute: AdminDataProps["onUpdateRoute"];
  onDeleteItem: AdminDataProps["onDeleteItem"];
};

const KIND_TITLE: Record<EditTarget["kind"], string> = {
  photo: "Edit photo",
  note: "Edit note",
  place: "Edit place",
  route: "Edit route",
};

export function EditItemPanel({ target, days, isSaving, onClose, onUpdatePhoto, onUpdateNote, onUpdatePlace, onUpdateRoute, onDeleteItem }: Props) {
  return (
    <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-40 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.97)] text-stone-950 shadow-[0_24px_80px_rgba(46,61,54,0.24)] backdrop-blur-xl md:bottom-6 md:left-auto md:right-6 md:w-[28rem]">
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-semibold tracking-tight">{KIND_TITLE[target.kind]}</h2>
            <p className="mt-1 text-sm leading-5 text-stone-600">Update the details or remove it from the trip.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-500 hover:bg-stone-900/5" aria-label="Close editor"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">
          {target.kind === "photo" ? (
            <PhotoEditor
              photo={target.item}
              days={days}
              isSaving={isSaving}
              onSave={async (id, input) => { await onUpdatePhoto(id, input); onClose(); }}
              onDelete={async () => { await onDeleteItem("photos", target.item.id); onClose(); }}
            />
          ) : null}
          {target.kind === "note" ? (
            <NoteEditor
              note={target.item}
              days={days}
              isSaving={isSaving}
              onSave={async (id, input) => { await onUpdateNote(id, input); onClose(); }}
              onDelete={async () => { await onDeleteItem("notes", target.item.id); onClose(); }}
            />
          ) : null}
          {target.kind === "place" ? (
            <PlaceEditor
              place={target.item}
              days={days}
              isSaving={isSaving}
              onSave={async (id, input) => { await onUpdatePlace(id, input); onClose(); }}
              onDelete={async () => { await onDeleteItem("places", target.item.id); onClose(); }}
            />
          ) : null}
          {target.kind === "route" ? (
            <RouteEditor
              route={target.item}
              days={days}
              isSaving={isSaving}
              onSave={async (id, input) => { await onUpdateRoute(id, input); onClose(); }}
              onDelete={async () => { await onDeleteItem("route_segments", target.item.id); onClose(); }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
