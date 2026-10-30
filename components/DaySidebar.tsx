"use client";

import dynamic from "next/dynamic";
import { Anchor, Bus, CalendarDays, Camera, Check, ChevronLeft, ChevronRight, FileText, Footprints, Loader2, Map, MapPin, Mountain, PanelLeftClose, PenLine, Play, Route, ShieldCheck, UserPlus, Users, Video, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AdminDataProps } from "@/components/AdminDataPanel";
import { JourneyHeroCard } from "@/components/JourneyHeroCard";
import { Button } from "@/components/ui/Button";
import { InlineMessage } from "@/components/ui/InlineMessage";
import { SectionCard } from "@/components/ui/SectionCard";
import { dayColorFor } from "@/lib/day-colors";
import { startJourneyAtDayLabel } from "@/lib/journey";
import { formatDayStats, formatKm, type TripDayStats } from "@/lib/trip-view-model";
import { cn, formatDateOnly } from "@/lib/utils";
import type { AdminRequest, AdminRequestStatus, Day, Note, Photo, Place, RouteMode, Trip, TripMember } from "@/types/trip";

export type LayerVisibility = { photos: boolean; notes: boolean; routes: boolean };

// On desktop the sidebar floats over a full-bleed map. The page publishes how
// much of the map's left edge it covers (0 while collapsed) here, so camera
// framing in page.tsx and MapView can centre content in the visible part.
export const SIDEBAR_INSET_VAR = "--sidebar-inset";
// The open sidebar's footprint: 1rem margin + 24rem panel + 1rem breathing room.
export const SIDEBAR_OPEN_INSET_PX = 416;

export function sidebarInset() {
  if (typeof window === "undefined" || window.innerWidth < 768) return 0;
  const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(SIDEBAR_INSET_VAR));
  // Unset until the page publishes it; the sidebar starts open.
  return Number.isFinite(inset) ? Math.max(0, inset) : SIDEBAR_OPEN_INSET_PX;
}

const AdminDataPanel = dynamic(() => import("@/components/AdminDataPanel").then((mod) => mod.AdminDataPanel));

// Per-day totals shown on the day cards so picking a day is informed: how much
// media it holds, how many journal pins, and how far its routes run.
export type DayStats = TripDayStats;

// Everything the Journey hero and per-day play buttons need. Optional so the
// sidebar still renders before journey data is ready (or when there's none).
export type JourneyEntry = {
  photos: Photo[];
  momentCount: number;
  dayCount: number;
  // The selected day, when there is one: the hero then offers to start the
  // journey at that day (it plays on through the trip) and previews its photos.
  day: Day | null;
  onPlay: () => void;
  onPlayDay: (dayId: string) => void;
  disabled?: boolean;
};

export type SidebarProps = {
  trip: Trip | null;
  days: Day[];
  dayStats?: Map<string, DayStats>;
  dayColors: Map<string, string>;
  // Each day's photos, for the filmstrip on its card.
  dayPhotos?: Map<string, Photo[]>;
  selectedDayId: string | null;
  onSelectDay: (dayId: string | null) => void;
  onStepDay: (direction: 1 | -1) => void;
  layerVisibility: LayerVisibility;
  onLayerVisibilityChange: (next: LayerVisibility) => void;
  showLayerControls?: boolean;
  onStartPhotoUpload?: () => void;
  onStartAddNote?: () => void;
  onStartRouteDraw?: () => void;
  journey?: JourneyEntry | null;
  adminData?: AdminDataProps | null;
  memberAdmin?: MemberAdminProps | null;
  adminRequest?: AdminRequestProps | null;
  notesPlaces?: NotesPlacesEntry | null;
  // Desktop only: tucks the floating sidebar away so the map gets the screen.
  onCollapse?: () => void;
};

// Notes and places are Mapbox map layers with click-only handlers, so there's
// no way to reach them with a keyboard. This list gives keyboard/screen-reader
// users the same "open its editor/popup path" outcome as clicking the marker.
export type NotesPlacesEntry = {
  notes: Note[];
  places: Place[];
  onOpen: (kind: "note" | "place", id: string) => void;
};

export type MemberAdminProps = {
  members: TripMember[];
  requests: AdminRequest[];
  currentUserId: string | null;
  message: string | null;
  messageTone: "info" | "error";
  isSaving: boolean;
  onGrantMember: (input: { email: string; role: "admin" | "member" }) => Promise<void>;
  onSetMemberRole: (targetUserId: string, role: "admin" | "member") => Promise<void>;
  onResolveRequest: (requestId: string, approve: boolean) => Promise<void>;
};

export type AdminRequestProps = {
  status: AdminRequestStatus | null;
  isSaving: boolean;
  message: string | null;
  messageTone: "info" | "error";
  onRequestAdmin: () => Promise<void>;
};

// Badge text: the full date range when known ("May 27 – Jun 3, 2026"),
// falling back to the year, then a generic label.
function tripDatesLabel(trip: Trip | null): string {
  if (!trip?.start_date) return "Trip";
  const startYear = trip.start_date.slice(0, 4);
  if (!trip.end_date) return startYear;
  const endYear = trip.end_date.slice(0, 4);
  if (startYear !== endYear) return `${formatDateOnly(trip.start_date)}, ${startYear} – ${formatDateOnly(trip.end_date)}, ${endYear}`;
  return `${formatDateOnly(trip.start_date)} – ${formatDateOnly(trip.end_date)}, ${startYear}`;
}

// A same-height skeleton in place of the title so a still-loading trip
// doesn't flash the "Trip Logbook" fallback before the real title arrives.
function TitleSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "motion-safe:animate-pulse rounded-full bg-stone-200/80",
        compact ? "h-6 w-40" : "h-10 w-64",
      )}
    />
  );
}

export function SidebarHeader({ trip, compact = false }: { trip: Trip | null; compact?: boolean }) {
  // Compact: the mobile sheet already shows the trip title in the app header
  // chip, so repeating the full hero block there just pushes the day list down.
  if (compact) {
    return (
      <div className="space-y-0.5">
        {trip ? <h1 className="font-serif text-xl font-semibold tracking-tight text-stone-950">{trip.title}</h1> : <TitleSkeleton compact />}
        {trip?.description ? <p className="text-sm leading-6 text-stone-600">{trip.description}</p> : null}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="inline-flex items-center gap-2 rounded-full border border-teal-700/20 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-900">
        <Mountain className="h-3.5 w-3.5" /> {tripDatesLabel(trip)}
      </div>
      {trip ? (
        <h1 className="font-serif text-[2.6rem] font-semibold leading-[0.95] tracking-tight text-stone-950">{trip.title}</h1>
      ) : <TitleSkeleton />}
      {trip?.description ? <p className="max-w-[28rem] text-sm leading-6 text-stone-600">{trip.description}</p> : null}
    </div>
  );
}

export function QuickActions({ onStartPhotoUpload, onStartAddNote, onStartRouteDraw }: Pick<SidebarProps, "onStartPhotoUpload" | "onStartAddNote" | "onStartRouteDraw">) {
  if (!onStartPhotoUpload && !onStartAddNote && !onStartRouteDraw) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {onStartPhotoUpload ? (
        <Button onClick={onStartPhotoUpload} size="sm" className="text-sm hover:-translate-y-0.5 active:translate-y-0">
          <Camera className="h-4 w-4" /> Upload media
        </Button>
      ) : null}
      {onStartAddNote ? (
        <Button onClick={onStartAddNote} variant="secondary" size="sm" className="text-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0">
          <FileText className="h-4 w-4" /> Add note
        </Button>
      ) : null}
      {onStartRouteDraw ? (
        <Button onClick={onStartRouteDraw} variant="secondary" tone="fjord" size="sm" className="col-span-full text-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0">
          <PenLine className="h-4 w-4" /> Draw route
        </Button>
      ) : null}
    </div>
  );
}

// The little colour dot that ties a day card to its route line and markers.
export function DayDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white", className)} style={{ backgroundColor: color }} />;
}

type DayListProps = Pick<SidebarProps, "days" | "dayStats" | "dayColors" | "dayPhotos" | "selectedDayId" | "onSelectDay" | "onStepDay"> & {
  onPlayDay?: (dayId: string) => void;
  // The mobile sheet already has a day stepper in its peek header, so it
  // hides this one rather than showing two.
  showStepButtons?: boolean;
};

// A day's covers: up to four of its photos spread across the day, as small
// square prints. marker_url is the 144px square the map already loads, so the
// strip usually costs nothing; older photos without one fall back to the
// thumbnail.
const FILMSTRIP_COUNT = 4;

export function dayFilmstripPhotos(photos: Photo[]): Photo[] {
  const stills = photos
    .filter((photo) => photo.media_type !== "video" && (photo.marker_url || photo.thumbnail_url))
    .sort((a, b) => (a.taken_at || a.created_at).localeCompare(b.taken_at || b.created_at));
  if (stills.length <= FILMSTRIP_COUNT) return stills;
  const step = stills.length / FILMSTRIP_COUNT;
  return Array.from({ length: FILMSTRIP_COUNT }, (_, index) => stills[Math.floor(index * step + step / 2)]);
}

function DayFilmstrip({ photos }: { photos: Photo[] }) {
  if (photos.length === 0) return null;
  return (
    <span aria-hidden className="mb-3 grid h-16 grid-cols-4 gap-1 overflow-hidden rounded-lg">
      {photos.map((photo) => {
        const fallback = photo.thumbnail_url ?? undefined;
        return (
          // eslint-disable-next-line @next/next/no-img-element -- user media URLs from R2
          <img
            key={photo.id}
            src={photo.marker_url || fallback}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(event) => {
              if (fallback && event.currentTarget.src !== fallback) event.currentTarget.src = fallback;
            }}
            className="h-full w-full bg-stone-200 object-cover transition-transform duration-500 group-hover:scale-[1.04] motion-reduce:transition-none"
          />
        );
      })}
    </span>
  );
}

const MODE_ICON: Record<RouteMode, typeof Footprints> = { hike: Footprints, walk: Footprints, bus: Bus, ferry: Anchor, other: Route };
const MODE_STAT_ORDER: RouteMode[] = ["hike", "walk", "bus", "ferry", "other"];

// The day's numbers as small icon-and-figure pairs: media, journal pins, and
// distance by how it was covered. Read aloud via the card's own label.
function DayStatsRow({ stats }: { stats: DayStats | undefined }) {
  if (!stats) return null;
  const items: Array<{ key: string; icon: typeof Camera; label: string }> = [];
  if (stats.photos) items.push({ key: "photos", icon: Camera, label: String(stats.photos) });
  if (stats.videos) items.push({ key: "videos", icon: Video, label: String(stats.videos) });
  if (stats.journal) items.push({ key: "pins", icon: MapPin, label: String(stats.journal) });
  for (const mode of MODE_STAT_ORDER) {
    const km = formatKm(stats.distanceByMode[mode] ?? 0);
    if (km) items.push({ key: mode, icon: MODE_ICON[mode], label: km });
  }
  if (items.length === 0) return null;
  return (
    <span aria-hidden className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium tabular-nums text-stone-600">
      {items.map(({ key, icon: Icon, label }) => (
        <span key={key} className="inline-flex items-center gap-1">
          <Icon className="h-3.5 w-3.5 text-stone-400" /> {label}
        </span>
      ))}
    </span>
  );
}

export function DayList({ days, dayStats, dayColors, dayPhotos, selectedDayId, onSelectDay, onStepDay, onPlayDay, showStepButtons = true }: DayListProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-stone-900">
        <CalendarDays className="h-4 w-4 text-teal-700" /> Trip days
        {showStepButtons ? (
          <span className="ml-auto flex items-center gap-1">
            <button onClick={() => onStepDay(-1)} aria-label="Previous day" title="Previous day (←)" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white/75 text-stone-600 transition hover:border-stone-300 hover:bg-white hover:text-stone-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20 active:scale-[0.95] md:h-7 md:w-7"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => onStepDay(1)} aria-label="Next day" title="Next day (→)" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white/75 text-stone-600 transition hover:border-stone-300 hover:bg-white hover:text-stone-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20 active:scale-[0.95] md:h-7 md:w-7"><ChevronRight className="h-4 w-4" /></button>
          </span>
        ) : null}
      </div>
      <div className="space-y-2.5">
        <button
          onClick={() => onSelectDay(null)}
          aria-pressed={selectedDayId === null}
          className={cn(
            "w-full rounded-xl border px-4 py-3 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20",
            selectedDayId === null ? "border-teal-700/35 bg-teal-50 shadow-sm" : "border-stone-200 bg-white/75 hover:border-stone-300 hover:bg-white",
          )}
        >
          <div className="font-bold text-stone-950">All days</div>
          <div className="text-xs text-stone-500">Show the whole adventure</div>
        </button>
        {days.map((day) => {
          const stats = dayStats?.get(day.id);
          // Only days with something to show get a play button — an empty day
          // would just drop the viewer onto someone else's moment.
          const canPlay = Boolean(onPlayDay) && Boolean(stats && (stats.photos > 0 || stats.videos > 0 || stats.journal > 0));
          const color = dayColorFor(dayColors, day.id);
          const selected = selectedDayId === day.id;
          const statsLabel = formatDayStats(stats);
          const strip = dayFilmstripPhotos(dayPhotos?.get(day.id) ?? []);
          const title = `Day ${day.day_number}: ${day.title ?? "Open trail"}`;
          return (
            <div key={day.id} className="group relative">
              <button
                onClick={() => onSelectDay(day.id)}
                aria-pressed={selected}
                aria-label={[title, day.date ? formatDateOnly(day.date) : null, day.summary, statsLabel].filter(Boolean).join(". ")}
                // Selection tints the whole card in the day's own colour, so
                // the list and the route on the map visibly belong together.
                style={selected
                  ? { borderColor: `color-mix(in srgb, ${color} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${color} 9%, var(--color-paper))`, boxShadow: `0 10px 28px -12px color-mix(in srgb, ${color} 55%, transparent)` }
                  : undefined}
                className={cn(
                  "w-full overflow-hidden rounded-xl border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20",
                  !selected && "border-stone-200/90 bg-white/75 hover:border-stone-300 hover:bg-white",
                )}
              >
                <DayFilmstrip photos={strip} />
                <span className={cn("block px-1", canPlay && strip.length === 0 && "pr-11")}>
                  <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    <DayDot color={color} className="h-2 w-2 ring-0" />
                    Day {day.day_number}{day.date ? ` · ${formatDateOnly(day.date)}` : ""}
                  </span>
                  <span className="mt-0.5 block font-serif text-lg font-semibold leading-snug text-stone-950">{day.title ?? "Open trail"}</span>
                  {day.summary ? <span className="mt-0.5 block text-[13px] leading-5 text-stone-500">{day.summary}</span> : null}
                  <DayStatsRow stats={stats} />
                </span>
              </button>
              {canPlay ? (
                <button
                  type="button"
                  onClick={() => onPlayDay?.(day.id)}
                  aria-label={startJourneyAtDayLabel(day.day_number)}
                  title={startJourneyAtDayLabel(day.day_number)}
                  // Sits on the filmstrip's corner like a play badge on a
                  // video; without a strip, in the card's top-right corner.
                  className={cn(
                    "absolute right-[1.4rem] inline-flex h-9 w-9 items-center justify-center rounded-full bg-paper/95 text-ember-600 shadow-md ring-1 ring-stone-900/5 backdrop-blur transition hover:scale-105 hover:bg-[#fdf1dc] hover:text-ember-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ember-400/30 active:scale-95",
                    strip.length > 0 ? "top-[1.4rem]" : "top-3.5",
                  )}
                >
                  <Play className="h-4 w-4 fill-current" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Shown instead of the day list while a trip is still loading (no days and no
// trip yet), so the sidebar doesn't flash an empty "All days only" state.
export function DayListSkeleton() {
  return (
    <section aria-hidden className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div key={index} className="motion-safe:animate-pulse rounded-xl border border-stone-200 bg-white/75 px-4 py-3">
          <div className="h-4 w-2/3 rounded-full bg-stone-200/80" />
          <div className="mt-2 h-3 w-full rounded-full bg-stone-200/60" />
        </div>
      ))}
    </section>
  );
}

// Each toggle row doubles as the legend: the swatch shows how that layer is
// drawn on the map, so there's no separate legend to open. Keep the swatches
// in step with the paint properties in TripLayers and map-overrides.css.
const LAYER_ROWS: Array<{ key: keyof LayerVisibility; label: string; hint: string; swatch: ReactNode }> = [
  {
    key: "routes",
    label: "Routes",
    hint: "coloured by day · ferries dashed",
    swatch: (
      <span aria-hidden className="flex items-center gap-1">
        <span className="h-1 w-4 rounded-full bg-fjord" />
        <span className="h-1 w-4 rounded-full border-t-4 border-dashed border-fjord/80 bg-transparent" />
      </span>
    ),
  },
  {
    key: "photos",
    label: "Photos & videos",
    hint: "thumbnails on the map",
    swatch: <span aria-hidden className="h-3.5 w-3.5 rounded-[4px] border-2 border-paper bg-ember-400 shadow-sm" />,
  },
  {
    key: "notes",
    label: "Notes & places",
    hint: "journal pins",
    swatch: (
      <span aria-hidden className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-full bg-[#f6d28f] ring-2 ring-[#7c4a14]/60" />
        <span className="h-3 w-3 rounded-full bg-[#c8e4d4] ring-2 ring-[#0f5f55]/60" />
      </span>
    ),
  },
];

export function LayersPanel({ layerVisibility, onLayerVisibilityChange }: Pick<SidebarProps, "layerVisibility" | "onLayerVisibilityChange">) {
  return (
    <SectionCard icon={Map} title="Layers">
      {LAYER_ROWS.map(({ key, label, hint, swatch }) => (
        <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-control)] bg-paper-tint px-3 py-2 text-sm text-stone-800 transition hover:bg-[#f1e8d8]">
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex w-9 shrink-0 justify-center">{swatch}</span>
            <span className="min-w-0">
              <span className="block font-semibold">{label}</span>
              <span className="block text-xs text-stone-500">{hint}</span>
            </span>
          </span>
          <input type="checkbox" checked={layerVisibility[key]} onChange={(event) => onLayerVisibilityChange({ ...layerVisibility, [key]: event.target.checked })} className="h-4 w-4 shrink-0 accent-teal-700" />
        </label>
      ))}
    </SectionCard>
  );
}

const NOTES_PLACES_VISIBLE_LIMIT = 6;

export function NotesPlacesList({ notes, places, onOpen }: NotesPlacesEntry) {
  const [expanded, setExpanded] = useState(false);
  const items = [
    ...notes.map((note) => ({ kind: "note" as const, id: note.id, label: note.body?.trim() || "Trail note" })),
    ...places.map((place) => ({ kind: "place" as const, id: place.id, label: place.name?.trim() || "Place" })),
  ];
  if (items.length === 0) return null;
  const collapsible = items.length > NOTES_PLACES_VISIBLE_LIMIT;
  const visible = expanded || !collapsible ? items : items.slice(0, NOTES_PLACES_VISIBLE_LIMIT);

  return (
    <SectionCard icon={MapPin} title="Notes & places">
      <div className="space-y-1.5">
        {visible.map((item) => (
          <button
            key={`${item.kind}:${item.id}`}
            type="button"
            onClick={() => onOpen(item.kind, item.id)}
            className="flex w-full items-center gap-2 truncate rounded-[var(--radius-control)] bg-paper-tint px-3 py-2 text-left text-sm text-stone-800 transition hover:bg-[#f1e8d8]"
          >
            <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-teal-800">{item.kind}</span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-xs font-bold text-teal-800 underline-offset-2 hover:underline"
        >
          {expanded ? "Show less" : `Show ${items.length - NOTES_PLACES_VISIBLE_LIMIT} more`}
        </button>
      ) : null}
    </SectionCard>
  );
}

export function MemberAdminPanel({ members, requests, currentUserId, message, messageTone, isSaving, onGrantMember, onSetMemberRole, onResolveRequest }: MemberAdminProps) {
  async function submit(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    const role = String(formData.get("role") || "member") as "admin" | "member";
    if (email) await onGrantMember({ email, role });
  }

  return (
    <SectionCard icon={Users} title="Members">
      <form action={submit} className="space-y-2">
        <input name="email" type="email" required placeholder="friend@example.com" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select name="role" defaultValue="member" className="rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" tone="fjord" size="sm" disabled={isSaving} className="px-3">
            {isSaving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <UserPlus className="h-4 w-4" />} Add
          </Button>
        </div>
      </form>
      {message ? <InlineMessage tone={messageTone} className="text-xs">{message}</InlineMessage> : null}
      {requests.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-amber-300/60 bg-amber-50/70 p-2.5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-amber-900"><ShieldCheck className="h-3.5 w-3.5" /> Admin requests</div>
          {requests.map((request) => (
            <div key={request.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-semibold text-stone-800" title={request.email ?? undefined}>{request.display_name ?? request.email ?? request.user_id}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <button disabled={isSaving} onClick={() => onResolveRequest(request.id, true)} aria-label="Approve admin request" className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-700 text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-50 md:h-7 md:w-7"><Check className="h-4 w-4" /></button>
                <button disabled={isSaving} onClick={() => onResolveRequest(request.id, false)} aria-label="Deny admin request" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-300/30 active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-50 md:h-7 md:w-7"><X className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="space-y-1.5">
        {members.map((member) => (
          <div key={member.user_id} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-paper-tint px-3 py-2 text-sm">
            <span className="min-w-0 truncate font-semibold text-stone-800">{member.display_name ?? member.user_id}{member.user_id === currentUserId ? " (you)" : ""}</span>
            <select
              value={member.role}
              disabled={isSaving}
              onChange={(event) => onSetMemberRole(member.user_id, event.target.value as "admin" | "member")}
              aria-label={`Role for ${member.display_name ?? member.user_id}`}
              className="shrink-0 rounded-full border border-stone-300 bg-white px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-stone-600 outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function AdminRequestPanel({ status, isSaving, message, messageTone, onRequestAdmin }: AdminRequestProps) {
  const pending = status === "pending";
  return (
    <SectionCard icon={ShieldCheck} title="Admin access">
      <p className="text-xs leading-5 text-stone-600">
        {pending
          ? "Your admin request is pending. An existing admin will review it."
          : status === "denied"
            ? "Your last admin request was denied. You can ask again."
            : "Want to edit trip days, routes, and other members? Request admin access."}
      </p>
      <Button
        variant="secondary"
        tone="fjord"
        size="sm"
        disabled={isSaving || pending}
        onClick={onRequestAdmin}
        className="w-full"
      >
        {isSaving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {pending ? "Request pending" : status === "denied" ? "Request admin again" : "Request admin"}
      </Button>
      {message ? <InlineMessage tone={messageTone} className="text-xs">{message}</InlineMessage> : null}
    </SectionCard>
  );
}

export function DaySidebar(props: SidebarProps) {
  return (
    <aside className="relative flex h-full max-h-[78dvh] min-h-0 flex-col gap-4 overflow-y-auto rounded-panel border border-white/60 bg-paper/86 p-4 text-stone-950 shadow-panel backdrop-blur-2xl backdrop-saturate-150 md:max-h-none md:w-96 md:p-5">
      {props.onCollapse ? (
        <button
          type="button"
          onClick={props.onCollapse}
          aria-label="Hide sidebar"
          title="Hide sidebar"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-900/5 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      ) : null}
      <SidebarHeader trip={props.trip} />
      {props.journey ? (
        <JourneyHeroCard
          photos={props.journey.photos}
          momentCount={props.journey.momentCount}
          dayCount={props.journey.dayCount}
          day={props.journey.day}
          onPlay={props.journey.onPlay}
          disabled={props.journey.disabled}
        />
      ) : null}
      <QuickActions onStartPhotoUpload={props.onStartPhotoUpload} onStartAddNote={props.onStartAddNote} onStartRouteDraw={props.onStartRouteDraw} />
      {props.days.length === 0 && props.trip === null ? (
        <DayListSkeleton />
      ) : (
        <DayList days={props.days} dayStats={props.dayStats} dayColors={props.dayColors} dayPhotos={props.dayPhotos} selectedDayId={props.selectedDayId} onSelectDay={props.onSelectDay} onStepDay={props.onStepDay} onPlayDay={props.journey?.onPlayDay} />
      )}
      {props.showLayerControls !== false ? <LayersPanel layerVisibility={props.layerVisibility} onLayerVisibilityChange={props.onLayerVisibilityChange} /> : null}
      {props.notesPlaces ? <NotesPlacesList {...props.notesPlaces} /> : null}
      {props.adminData ? <AdminDataPanel {...props.adminData} /> : null}
      {props.memberAdmin ? <MemberAdminPanel {...props.memberAdmin} /> : null}
      {props.adminRequest ? <AdminRequestPanel {...props.adminRequest} /> : null}
    </aside>
  );
}
