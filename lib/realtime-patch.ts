import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMemberAvatars, resolvePhotoUrls } from "./supabase";
import type { AdminRequest, Note, Photo, Place, RouteSegment, TripData, TripMember } from "@/types/trip";

type ChangePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

function upsertById<T extends { id: string }>(items: T[], row: T): T[] {
  const index = items.findIndex((item) => item.id === row.id);
  if (index === -1) return [row, ...items];
  const next = [...items];
  next[index] = row;
  return next;
}

function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

function memberKey(member: TripMember) {
  return member.user_id;
}

function upsertMember(items: TripMember[], row: TripMember): TripMember[] {
  const index = items.findIndex((item) => memberKey(item) === memberKey(row));
  if (index === -1) return [...items, row];
  const next = [...items];
  next[index] = row;
  return next;
}

function removeMember(items: TripMember[], userId: string): TripMember[] {
  return items.filter((item) => item.user_id !== userId);
}

/** Apply a single Realtime postgres change to trip data without a full refetch. */
export function applyRealtimeChange(
  data: TripData,
  table: string,
  payload: ChangePayload,
  client: SupabaseClient | null,
): TripData {
  const { eventType } = payload;
  const row = (eventType === "DELETE" ? payload.old : payload.new) as Record<string, unknown>;
  const id = String(row.id ?? "");

  switch (table) {
    case "photos": {
      if (eventType === "DELETE") {
        return { ...data, photos: removeById(data.photos, id) };
      }
      const photos = upsertById(data.photos, payload.new as Photo);
      return { ...data, photos: client ? resolvePhotoUrls(client, photos) : photos };
    }
    case "notes":
      if (eventType === "DELETE") return { ...data, notes: removeById(data.notes, id) };
      return { ...data, notes: upsertById(data.notes, payload.new as Note) };
    case "places":
      if (eventType === "DELETE") return { ...data, places: removeById(data.places, id) };
      return { ...data, places: upsertById(data.places, payload.new as Place) };
    case "route_segments":
      if (eventType === "DELETE") return { ...data, routeSegments: removeById(data.routeSegments, id) };
      return { ...data, routeSegments: upsertById(data.routeSegments, payload.new as RouteSegment) };
    case "trip_members": {
      const memberRow = row as unknown as TripMember;
      if (eventType === "DELETE") {
        return { ...data, members: removeMember(data.members, memberRow.user_id) };
      }
      const members = upsertMember(data.members, memberRow);
      return { ...data, members: client ? resolveMemberAvatars(client, members) : members };
    }
    case "admin_requests":
      if (eventType === "DELETE") return { ...data, adminRequests: removeById(data.adminRequests, id) };
      return { ...data, adminRequests: upsertById(data.adminRequests, payload.new as AdminRequest) };
    default:
      return data;
  }
}
