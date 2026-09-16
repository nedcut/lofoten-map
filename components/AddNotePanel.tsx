"use client";

import { Loader2, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { InlineMessage } from "@/components/ui/InlineMessage";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { clearNoteDraft, readNoteDraft, writeNoteDraft } from "@/lib/offline-drafts";
import type { Day, LngLat } from "@/types/trip";

type Props = {
  tripSlug: string;
  days: Day[];
  selectedCoordinate: LngLat | null;
  defaultDayId: string | null;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (input: { body: string; authorName: string; dayId: string | null }) => Promise<void>;
};

function noteDraftHint(hasCoordinate: boolean, hasBody: boolean) {
  if (!hasCoordinate && !hasBody) return "Pick a map location and write a note to save it.";
  if (!hasCoordinate) return "Pick a map location to save this note.";
  if (!hasBody) return "Write a note to save this location.";
  return "Note is ready to save.";
}

export function AddNotePanel({ tripSlug, days, selectedCoordinate, defaultDayId, isSaving, onCancel, onSave }: Props) {
  const savedDraft = readNoteDraft(tripSlug);
  const [body, setBody] = useState(savedDraft?.body ?? "");
  const [authorName, setAuthorName] = useState(savedDraft?.authorName ?? "");
  const [dayId, setDayId] = useState(savedDraft?.dayId ?? defaultDayId ?? "");
  const hasBody = body.trim().length > 0;
  const hasCoordinate = Boolean(selectedCoordinate);
  const hasDraft = Boolean(savedDraft?.body.trim() || savedDraft?.authorName.trim() || savedDraft?.coordinate);

  useEffect(() => {
    writeNoteDraft(tripSlug, {
      body,
      authorName,
      dayId: dayId || null,
      coordinate: selectedCoordinate,
      updatedAt: new Date().toISOString(),
    });
  }, [authorName, body, dayId, selectedCoordinate, tripSlug]);

  async function submit(formData: FormData) {
    await onSave({
      body: body.trim(),
      authorName: authorName.trim() || String(formData.get("authorName") ?? "").trim(),
      dayId: dayId || null,
    });
  }

  function handleCancel() {
    clearNoteDraft(tripSlug);
    onCancel();
  }

  return (
    <Panel className="md:w-96" labelledBy="add-note-title" onClose={handleCancel} modal={false}>
      <PanelHeader id="add-note-title" title="Add a trail note" subtitle="Tap the map to choose a location, then save a short note." onClose={handleCancel} closeLabel="Close note panel" />
      <form action={submit} aria-labelledby="add-note-title" className="min-h-0 space-y-3 overflow-y-auto pr-1">
        <InlineMessage>
          <MapPin className="mr-2 inline h-4 w-4" />
          {selectedCoordinate ? `${selectedCoordinate.lat.toFixed(5)}, ${selectedCoordinate.lng.toFixed(5)}` : "No coordinate yet. Click or tap the map."}
        </InlineMessage>
        <Field label="Note" hideLabel>
          <Textarea name="body" required maxLength={240} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Describe the viewpoint, camp spot, weather, or inside joke..." />
        </Field>
        <div aria-live="polite" className="rounded-[var(--radius-control)] border border-teal-700/15 bg-teal-50 px-3 py-2 text-xs font-semibold leading-5 text-teal-950">
          {hasDraft && !hasCoordinate ? "Draft restored. Pick a map location to finish saving." : noteDraftHint(hasCoordinate, hasBody)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Your name" hideLabel>
            <Input name="authorName" value={authorName} onChange={(event) => setAuthorName(event.target.value)} placeholder="Your name" />
          </Field>
          <Field label="Day" hideLabel>
            <Select name="dayId" value={dayId} onChange={(event) => setDayId(event.target.value)}>
              <option value="">All days</option>
              {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={!hasCoordinate || !hasBody || isSaving} className="w-full">
          {isSaving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : null} Save note
        </Button>
      </form>
    </Panel>
  );
}
