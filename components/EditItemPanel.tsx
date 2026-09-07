"use client";

import { NoteEditor, PhotoEditor, PlaceEditor, RouteEditor, noteEditorKey, photoEditorKey, placeEditorKey, routeEditorKey, type AdminDataProps } from "@/components/AdminDataPanel";
import { Panel, PanelHeader } from "@/components/ui/Panel";
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
    <Panel className="z-40 md:w-[28rem]" labelledBy="edit-item-title" onClose={onClose}>
      <PanelHeader id="edit-item-title" title={KIND_TITLE[target.kind]} subtitle="Update the details or remove it from the trip." onClose={onClose} closeLabel="Close editor" />
      <div aria-labelledby="edit-item-title" role="group" className="min-h-0 overflow-y-auto overscroll-contain pr-1">
          {/* Keyed on the item's content so the uncontrolled form remounts with
              fresh defaultValues when the item changes underneath it — e.g.
              dragging the marker while the editor is open. Without the key,
              Save would write the stale pre-drag coordinates back. */}
          {target.kind === "photo" ? (
            <PhotoEditor
              key={photoEditorKey(target.item)}
              photo={target.item}
              days={days}
              isSaving={isSaving}
              onSave={async (id, input) => { await onUpdatePhoto(id, input); onClose(); }}
              onDelete={async () => { await onDeleteItem("photos", target.item.id); onClose(); }}
            />
          ) : null}
          {target.kind === "note" ? (
            <NoteEditor
              key={noteEditorKey(target.item)}
              note={target.item}
              days={days}
              isSaving={isSaving}
              onSave={async (id, input) => { await onUpdateNote(id, input); onClose(); }}
              onDelete={async () => { await onDeleteItem("notes", target.item.id); onClose(); }}
            />
          ) : null}
          {target.kind === "place" ? (
            <PlaceEditor
              key={placeEditorKey(target.item)}
              place={target.item}
              days={days}
              isSaving={isSaving}
              onSave={async (id, input) => { await onUpdatePlace(id, input); onClose(); }}
              onDelete={async () => { await onDeleteItem("places", target.item.id); onClose(); }}
            />
          ) : null}
          {target.kind === "route" ? (
            <RouteEditor
              key={routeEditorKey(target.item)}
              route={target.item}
              days={days}
              isSaving={isSaving}
              onSave={async (id, input) => { await onUpdateRoute(id, input); onClose(); }}
              onDelete={async () => { await onDeleteItem("route_segments", target.item.id); onClose(); }}
            />
          ) : null}
      </div>
    </Panel>
  );
}
