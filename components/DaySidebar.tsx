"use client";

import { CalendarDays, Camera, Check, ChevronLeft, ChevronRight, FileText, Loader2, Map, Mountain, PenLine, Play, Route, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { AdminDataPanel, type AdminDataProps } from "@/components/AdminDataPanel";
import { JourneyHeroCard } from "@/components/JourneyHeroCard";
import { Button } from "@/components/ui/Button";
import { InlineMessage } from "@/components/ui/InlineMessage";
import { SectionCard } from "@/components/ui/SectionCard";
import type { TripDayStats } from "@/lib/trip-view-model";
import { cn, formatDateOnly } from "@/lib/utils";
import type { AdminRequest, AdminRequestStatus, Day, Photo, Trip, TripMember } from "@/types/trip";

export type LayerVisibility = { photos: boolean; notes: boolean; routes: boolean };

// Per-day totals shown on the day cards so picking a day is informed: how much
// media it holds, how many journal pins, and how far its routes run.
export type DayStats = TripDayStats;

// Everything the Journey hero and per-day play buttons need. Optional so the
// sidebar still renders before journey data is ready (or when there's none).
export type JourneyEntry = {
  photos: Photo[];
  momentCount: number;
  dayCount: number;
  onPlay: () => void;
  onPlayDay: (dayId: string) => void;
  disabled?: boolean;
};

export type SidebarProps = {
  trip: Trip | null;
  days: Day[];
  dayStats?: Map<string, DayStats>;
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

// "29 media · 2 pins · 7.4 km" — only the parts a day actually has.
function dayStatsLabel(stats: DayStats | undefined): string | null {
  if (!stats) return null;
  const km = stats.distanceMeters / 1000;
  const parts = [
    stats.media ? `${stats.media} media` : null,
    stats.journal ? `${stats.journal} pin${stats.journal === 1 ? "" : "s"}` : null,
    km >= 0.1 ? `${km.toFixed(km < 10 ? 1 : 0)} km` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function DayList({ days, dayStats, selectedDayId, onSelectDay, onStepDay, onPlayDay }: Pick<SidebarProps, "days" | "dayStats" | "selectedDayId" | "onSelectDay" | "onStepDay"> & { onPlayDay?: (dayId: string) => void }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-stone-900">
        <CalendarDays className="h-4 w-4 text-teal-700" /> Trip days
        <span className="ml-auto flex items-center gap-1">
          <button onClick={() => onStepDay(-1)} aria-label="Previous day" title="Previous day (←)" className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 bg-white/75 text-stone-600 transition hover:border-stone-300 hover:bg-white hover:text-stone-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20 active:scale-[0.95]"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => onStepDay(1)} aria-label="Next day" title="Next day (→)" className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 bg-white/75 text-stone-600 transition hover:border-stone-300 hover:bg-white hover:text-stone-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20 active:scale-[0.95]"><ChevronRight className="h-4 w-4" /></button>
        </span>
      </div>
      <div className="space-y-2">
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
          const canPlay = Boolean(onPlayDay) && Boolean(stats && (stats.media > 0 || stats.journal > 0));
          return (
            <div key={day.id} className="group relative">
              <button
                onClick={() => onSelectDay(day.id)}
                aria-pressed={selectedDayId === day.id}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20",
                  canPlay && "pr-14",
                  selectedDayId === day.id ? "border-teal-700/35 bg-teal-50 shadow-sm" : "border-stone-200 bg-white/75 hover:border-stone-300 hover:bg-white",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-stone-950">Day {day.day_number}: {day.title ?? "Open trail"}</span>
                  {day.date ? <span className="shrink-0 rounded-full bg-teal-700/10 px-2 py-0.5 text-xs font-bold text-teal-800">{formatDateOnly(day.date)}</span> : null}
                </div>
                {day.summary ? <div className="mt-1 text-[13px] leading-5 text-stone-500">{day.summary}</div> : null}
                {dayStatsLabel(stats) ? (
                  <div className="mt-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-teal-900/80">{dayStatsLabel(stats)}</div>
                ) : null}
              </button>
              {canPlay ? (
                <button
                  type="button"
                  onClick={() => onPlayDay?.(day.id)}
                  aria-label={`Relive Day ${day.day_number}`}
                  title={`Relive Day ${day.day_number}`}
                  className="absolute right-2.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200 bg-white text-ember-600 shadow-sm transition hover:-translate-y-1/2 hover:scale-105 hover:border-ember-400/60 hover:bg-[#fdf1dc] hover:text-ember-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ember-400/30 active:scale-95"
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

export function LayersPanel({ layerVisibility, onLayerVisibilityChange }: Pick<SidebarProps, "layerVisibility" | "onLayerVisibilityChange">) {
  return (
    <SectionCard icon={Map} title="Layers">
      {([
        ["routes", "Routes", Route],
        ["photos", "Media", Camera],
        ["notes", "Notes & places", FileText],
      ] as const).map(([key, label, Icon]) => (
        <label key={key} className="flex cursor-pointer items-center justify-between rounded-[var(--radius-control)] bg-paper-tint px-3 py-2 text-sm text-stone-800 transition hover:bg-[#f1e8d8]">
          <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-teal-700" /> {label}</span>
          <input type="checkbox" checked={layerVisibility[key]} onChange={(event) => onLayerVisibilityChange({ ...layerVisibility, [key]: event.target.checked })} className="h-4 w-4 accent-teal-700" />
        </label>
      ))}
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
          <Button tone="fjord" size="sm" disabled={isSaving} className="px-3">
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
                <button disabled={isSaving} onClick={() => onResolveRequest(request.id, true)} aria-label="Approve admin request" className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-teal-700 text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-4 w-4" /></button>
                <button disabled={isSaving} onClick={() => onResolveRequest(request.id, false)} aria-label="Deny admin request" className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-300/30 active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-50"><X className="h-4 w-4" /></button>
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
    <aside className="flex h-full max-h-[78dvh] min-h-0 flex-col gap-4 overflow-y-auto rounded-panel border border-stone-200/80 bg-paper/94 p-4 text-stone-950 shadow-panel backdrop-blur-xl md:max-h-none md:w-96 md:p-5">
      <SidebarHeader trip={props.trip} />
      {props.journey ? (
        <JourneyHeroCard
          photos={props.journey.photos}
          momentCount={props.journey.momentCount}
          dayCount={props.journey.dayCount}
          onPlay={props.journey.onPlay}
          disabled={props.journey.disabled}
        />
      ) : null}
      <QuickActions onStartPhotoUpload={props.onStartPhotoUpload} onStartAddNote={props.onStartAddNote} onStartRouteDraw={props.onStartRouteDraw} />
      {props.days.length === 0 && props.trip === null ? (
        <DayListSkeleton />
      ) : (
        <DayList days={props.days} dayStats={props.dayStats} selectedDayId={props.selectedDayId} onSelectDay={props.onSelectDay} onStepDay={props.onStepDay} onPlayDay={props.journey?.onPlayDay} />
      )}
      {props.showLayerControls !== false ? <LayersPanel layerVisibility={props.layerVisibility} onLayerVisibilityChange={props.onLayerVisibilityChange} /> : null}
      {props.adminData ? <AdminDataPanel {...props.adminData} /> : null}
      {props.memberAdmin ? <MemberAdminPanel {...props.memberAdmin} /> : null}
      {props.adminRequest ? <AdminRequestPanel {...props.adminRequest} /> : null}
    </aside>
  );
}
