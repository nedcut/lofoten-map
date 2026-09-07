"use client";

import { Loader2, MapPin, RotateCcw, Route, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import type { Day, LngLat, RouteMode } from "@/types/trip";

type Props = {
  days: Day[];
  defaultDayId: string | null;
  points: LngLat[];
  distanceMeters: number;
  isSaving: boolean;
  onCancel: () => void;
  onUndoPoint: () => void;
  onClear: () => void;
  onSave: (input: { name: string; dayId: string | null; mode: RouteMode }) => Promise<void>;
};

const routeModes: Array<{ value: RouteMode; label: string }> = [
  { value: "hike", label: "Hike" },
  { value: "walk", label: "Walk" },
  { value: "ferry", label: "Ferry" },
  { value: "bus", label: "Bus" },
  { value: "other", label: "Other" },
];

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function routeDraftHint(pointCount: number) {
  if (pointCount === 0) return "Add at least 2 points on the map to save a route.";
  if (pointCount === 1) return "Add 1 more point to make this a saveable route.";
  return "Route is ready to save. Add more points to refine the path.";
}

export function ManualRoutePanel({ days, defaultDayId, points, distanceMeters, isSaving, onCancel, onUndoPoint, onClear, onSave }: Props) {
  async function submit(formData: FormData) {
    await onSave({
      name: String(formData.get("name") ?? "").trim(),
      dayId: String(formData.get("dayId") || "") || null,
      mode: String(formData.get("mode") || "hike") as RouteMode,
    });
  }

  return (
    <Panel className="md:w-96">
      <PanelHeader id="draw-route-title" title="Draw route" subtitle="Tap the map to place route points in order, then save it to a trip day." onClose={onCancel} closeLabel="Close route editor" />
      <form action={submit} aria-labelledby="draw-route-title" className="min-h-0 space-y-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-2 text-center text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
          <div className="rounded-[var(--radius-control)] border border-teal-700/20 bg-teal-50 px-3 py-2 text-teal-950">
            <Route className="mx-auto mb-1 h-4 w-4" />
            <span className="block text-base text-teal-950">{points.length}</span>
            Points
          </div>
          <div className="rounded-[var(--radius-control)] border border-stone-200 bg-white px-3 py-2 text-stone-600">
            <MapPin className="mx-auto mb-1 h-4 w-4 text-teal-700" />
            <span className="block text-base text-stone-950">{formatDistance(distanceMeters)}</span>
            Distance
          </div>
        </div>

        <Field label="Route name" hideLabel><Input name="name" placeholder="Route name" /></Field>

        <div aria-live="polite" className="rounded-[var(--radius-control)] border border-teal-700/15 bg-teal-50 px-3 py-2 text-xs font-semibold leading-5 text-teal-950">
          {routeDraftHint(points.length)}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Day" hideLabel>
            <Select name="dayId" defaultValue={defaultDayId ?? ""}>
              <option value="">All days</option>
              {days.map((day) => <option key={day.id} value={day.id}>Day {day.day_number}</option>)}
            </Select>
          </Field>
          <Field label="Mode" hideLabel>
            <Select name="mode" defaultValue="hike">
              {routeModes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-[auto_auto_1fr] gap-2">
          <button type="button" onClick={onUndoPoint} disabled={points.length === 0 || isSaving} className="rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45" aria-label="Undo route point">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClear} disabled={points.length === 0 || isSaving} className="rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45" aria-label="Clear route draft">
            <RotateCcw className="h-4 w-4" />
          </button>
          <Button disabled={points.length < 2 || isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <Save className="h-4 w-4" />} Save route
          </Button>
        </div>
      </form>
    </Panel>
  );
}
