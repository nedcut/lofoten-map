"use client";

import { CalendarDays, Camera, Check, FileText, Loader2, Map, Mountain, PenLine, Route, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { AdminDataPanel, type AdminDataProps } from "@/components/AdminDataPanel";
import { cn, formatDateOnly } from "@/lib/utils";
import type { AdminRequest, AdminRequestStatus, Day, Trip, TripMember } from "@/types/trip";

export type LayerVisibility = { photos: boolean; notes: boolean; routes: boolean };

export type SidebarProps = {
  trip: Trip | null;
  days: Day[];
  selectedDayId: string | null;
  onSelectDay: (dayId: string | null) => void;
  layerVisibility: LayerVisibility;
  onLayerVisibilityChange: (next: LayerVisibility) => void;
  onStartPhotoUpload?: () => void;
  onStartAddNote?: () => void;
  onStartRouteDraw?: () => void;
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

export function SidebarHeader({ trip }: { trip: Trip | null }) {
  return (
    <div className="space-y-2">
      <div className="inline-flex items-center gap-2 rounded-full border border-teal-700/20 bg-teal-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-900">
        <Mountain className="h-3.5 w-3.5" /> {trip?.start_date ? trip.start_date.slice(0, 4) : "Trip"}
      </div>
      <h1 className="font-serif text-[2.6rem] font-semibold leading-[0.95] tracking-tight text-stone-950">{trip?.title ?? "Trip Logbook"}</h1>
      <p className="max-w-[28rem] text-sm leading-6 text-stone-600">{trip?.description ?? "Shared route planning, photos, and trail notes."}</p>
    </div>
  );
}

export function QuickActions({ onStartPhotoUpload, onStartAddNote, onStartRouteDraw }: Pick<SidebarProps, "onStartPhotoUpload" | "onStartAddNote" | "onStartRouteDraw">) {
  if (!onStartPhotoUpload && !onStartAddNote && !onStartRouteDraw) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {onStartPhotoUpload ? (
        <button
          onClick={onStartPhotoUpload}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#e7a13d] px-4 py-3 text-sm font-black text-stone-950 shadow-[0_12px_28px_rgba(184,106,31,0.22)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-[#f0ae4b] hover:shadow-[0_16px_34px_rgba(184,106,31,0.3)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:translate-y-0 active:scale-[0.98]"
        >
          <Camera className="h-4 w-4" /> Upload photo
        </button>
      ) : null}
      {onStartAddNote ? (
        <button
          onClick={onStartAddNote}
          className="flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-bold text-stone-800 transition-all duration-150 hover:-translate-y-0.5 hover:border-stone-400 hover:bg-stone-50 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:translate-y-0 active:scale-[0.98]"
        >
          <FileText className="h-4 w-4" /> Add note
        </button>
      ) : null}
      {onStartRouteDraw ? (
        <button
          onClick={onStartRouteDraw}
          className="col-span-full flex items-center justify-center gap-2 rounded-xl border border-teal-700/25 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-950 transition-all duration-150 hover:-translate-y-0.5 hover:border-teal-700/40 hover:bg-teal-100 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20 active:translate-y-0 active:scale-[0.98]"
        >
          <PenLine className="h-4 w-4" /> Draw route
        </button>
      ) : null}
    </div>
  );
}

export function DayList({ days, selectedDayId, onSelectDay }: Pick<SidebarProps, "days" | "selectedDayId" | "onSelectDay">) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-stone-900"><CalendarDays className="h-4 w-4 text-teal-700" /> Trip days</div>
      <div className="space-y-2">
        <button
          onClick={() => onSelectDay(null)}
          className={cn(
            "w-full rounded-xl border px-4 py-3 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20",
            selectedDayId === null ? "border-teal-700/35 bg-teal-50 shadow-sm" : "border-stone-200 bg-white/75 hover:border-stone-300 hover:bg-white",
          )}
        >
          <div className="font-bold text-stone-950">All days</div>
          <div className="text-xs text-stone-500">Show the whole adventure</div>
        </button>
        {days.map((day) => (
          <button
            key={day.id}
            onClick={() => onSelectDay(day.id)}
            className={cn(
              "group w-full rounded-xl border px-4 py-3 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20",
              selectedDayId === day.id ? "border-teal-700/35 bg-teal-50 shadow-sm" : "border-stone-200 bg-white/75 hover:border-stone-300 hover:bg-white",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-stone-950">Day {day.day_number}: {day.title ?? "Open trail"}</span>
              {day.date ? <span className="shrink-0 rounded-full bg-teal-700/10 px-2 py-0.5 text-xs font-bold text-teal-800">{formatDateOnly(day.date)}</span> : null}
            </div>
            <div className="mt-1 text-xs leading-5 text-stone-500">{day.summary ?? "Route planning and shared memories."}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

export function LayersPanel({ layerVisibility, onLayerVisibilityChange }: Pick<SidebarProps, "layerVisibility" | "onLayerVisibilityChange">) {
  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white/75 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-stone-900"><Map className="h-4 w-4 text-teal-700" /> Layers</div>
      {([
        ["routes", "Routes", Route],
        ["photos", "Photos", Camera],
        ["notes", "Notes & places", FileText],
      ] as const).map(([key, label, Icon]) => (
        <label key={key} className="flex cursor-pointer items-center justify-between rounded-lg bg-[#f7f1e7] px-3 py-2 text-sm text-stone-800 transition hover:bg-[#f1e8d8]">
          <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-teal-700" /> {label}</span>
          <input type="checkbox" checked={layerVisibility[key]} onChange={(event) => onLayerVisibilityChange({ ...layerVisibility, [key]: event.target.checked })} className="h-4 w-4 accent-teal-700" />
        </label>
      ))}
    </section>
  );
}

export function MemberAdminPanel({ members, requests, currentUserId, message, messageTone, isSaving, onGrantMember, onSetMemberRole, onResolveRequest }: MemberAdminProps) {
  async function submit(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    const role = String(formData.get("role") || "member") as "admin" | "member";
    if (email) await onGrantMember({ email, role });
  }

  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white/75 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-stone-900"><Users className="h-4 w-4 text-teal-700" /> Members</div>
      <form action={submit} className="space-y-2">
        <input name="email" type="email" required placeholder="friend@example.com" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select name="role" defaultValue="member" className="rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 py-2.5 text-sm font-black text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Add
          </button>
        </div>
      </form>
      {message ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-xs leading-5",
            messageTone === "error" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-teal-700/15 bg-teal-50 text-teal-950",
          )}
        >
          {message}
        </div>
      ) : null}
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
          <div key={member.user_id} className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f1e7] px-3 py-2 text-sm">
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
    </section>
  );
}

export function AdminRequestPanel({ status, isSaving, message, messageTone, onRequestAdmin }: AdminRequestProps) {
  const pending = status === "pending";
  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white/75 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-stone-900"><ShieldCheck className="h-4 w-4 text-teal-700" /> Admin access</div>
      <p className="text-xs leading-5 text-stone-600">
        {pending
          ? "Your admin request is pending. An existing admin will review it."
          : status === "denied"
            ? "Your last admin request was denied. You can ask again."
            : "Want to edit trip days, routes, and other members? Request admin access."}
      </p>
      <button
        disabled={isSaving || pending}
        onClick={onRequestAdmin}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-teal-700/25 bg-teal-50 px-3 py-2.5 text-sm font-bold text-teal-950 transition hover:border-teal-700/40 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {pending ? "Request pending" : status === "denied" ? "Request admin again" : "Request admin"}
      </button>
      {message ? (
        <div className={cn("rounded-lg border px-3 py-2 text-xs leading-5", messageTone === "error" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-teal-700/15 bg-teal-50 text-teal-950")}>{message}</div>
      ) : null}
    </section>
  );
}

export function DaySidebar(props: SidebarProps) {
  return (
    <aside className="flex h-full max-h-[78dvh] min-h-0 flex-col gap-4 overflow-y-auto rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.94)] p-4 text-stone-950 shadow-[0_24px_80px_rgba(46,61,54,0.2)] backdrop-blur-xl md:max-h-none md:w-96 md:p-5">
      <SidebarHeader trip={props.trip} />
      <QuickActions onStartPhotoUpload={props.onStartPhotoUpload} onStartAddNote={props.onStartAddNote} onStartRouteDraw={props.onStartRouteDraw} />
      <DayList days={props.days} selectedDayId={props.selectedDayId} onSelectDay={props.onSelectDay} />
      <LayersPanel layerVisibility={props.layerVisibility} onLayerVisibilityChange={props.onLayerVisibilityChange} />
      {props.adminData ? <AdminDataPanel {...props.adminData} /> : null}
      {props.memberAdmin ? <MemberAdminPanel {...props.memberAdmin} /> : null}
      {props.adminRequest ? <AdminRequestPanel {...props.adminRequest} /> : null}
    </aside>
  );
}
