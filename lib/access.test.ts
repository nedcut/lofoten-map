import { describe, expect, it } from "vitest";
import { deriveTripAccess } from "./access";
import type { AdminRequest, TripMember } from "@/types/trip";

function member(overrides: Partial<TripMember>): TripMember {
  return {
    trip_id: "trip-1",
    user_id: "user-1",
    role: "member",
    display_name: "Friend",
    created_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function request(overrides: Partial<AdminRequest>): AdminRequest {
  return {
    id: "request-1",
    trip_id: "trip-1",
    user_id: "user-1",
    display_name: "Friend",
    email: "friend@example.com",
    note: null,
    status: "pending",
    created_at: "2026-06-01T00:00:00.000Z",
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

describe("deriveTripAccess", () => {
  it("treats demo mode as editable without a Supabase member", () => {
    const access = deriveTripAccess({ supabaseEnabled: false, userId: null, members: [], adminRequests: [] });
    expect(access.canContribute).toBe(true);
    expect(access.isAdmin).toBe(true);
    expect(access.showMemberAdminControls).toBe(false);
    expect(access.showAdminRequestControls).toBe(false);
  });

  it("keeps signed-out Supabase visitors in public view-only mode", () => {
    const access = deriveTripAccess({ supabaseEnabled: true, userId: null, members: [member({})], adminRequests: [] });
    expect(access.currentMember).toBeNull();
    expect(access.canContribute).toBe(false);
    expect(access.isAdmin).toBe(false);
    expect(access.showMemberAdminControls).toBe(false);
    expect(access.showAdminRequestControls).toBe(false);
  });

  it("lets signed-in members contribute and request admin access", () => {
    const current = member({ user_id: "user-1", role: "member" });
    const access = deriveTripAccess({ supabaseEnabled: true, userId: "user-1", members: [current], adminRequests: [] });
    expect(access.currentMember).toBe(current);
    expect(access.canContribute).toBe(true);
    expect(access.isAdmin).toBe(false);
    expect(access.showMemberAdminControls).toBe(false);
    expect(access.showAdminRequestControls).toBe(true);
  });

  it("shows admin management controls only to current admins", () => {
    const current = member({ user_id: "admin-1", role: "admin" });
    const access = deriveTripAccess({ supabaseEnabled: true, userId: "admin-1", members: [current], adminRequests: [] });
    expect(access.currentMember).toBe(current);
    expect(access.canContribute).toBe(true);
    expect(access.isAdmin).toBe(true);
    expect(access.showMemberAdminControls).toBe(true);
    expect(access.showAdminRequestControls).toBe(false);
  });

  it("chooses the newest request for the current user even if rows arrive unsorted", () => {
    const access = deriveTripAccess({
      supabaseEnabled: true,
      userId: "user-1",
      members: [member({})],
      adminRequests: [
        request({ id: "old", status: "denied", created_at: "2026-06-01T00:00:00.000Z" }),
        request({ id: "new", status: "pending", created_at: "2026-06-02T00:00:00.000Z" }),
      ],
    });
    expect(access.currentUserAdminRequest?.id).toBe("new");
  });

  it("returns pending admin requests newest first for admin review", () => {
    const access = deriveTripAccess({
      supabaseEnabled: true,
      userId: "admin-1",
      members: [member({ user_id: "admin-1", role: "admin" })],
      adminRequests: [
        request({ id: "approved", status: "approved", created_at: "2026-06-03T00:00:00.000Z" }),
        request({ id: "older", status: "pending", created_at: "2026-06-01T00:00:00.000Z" }),
        request({ id: "newer", status: "pending", created_at: "2026-06-02T00:00:00.000Z" }),
      ],
    });
    expect(access.pendingAdminRequests.map((item) => item.id)).toEqual(["newer", "older"]);
  });
});
