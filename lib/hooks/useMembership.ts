"use client";

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trip } from "@/types/trip";
import { useStatusMessage } from "./useStatusMessage";

type MemberRole = "admin" | "member";

interface Options {
  supabase: SupabaseClient | null;
  trip: Trip | null;
  /** Reload trip data after a successful write, so the change is reflected. */
  loadData: () => Promise<void>;
}

/**
 * Member-management RPCs (grant/promote/demote members, request and resolve
 * admin access) plus their shared status channel. Every call clears the panel
 * message, runs the RPC, surfaces success or failure, and reloads on success.
 * No-ops in demo mode (no Supabase client).
 */
export function useMembership({ supabase, trip, loadData }: Options) {
  const status = useStatusMessage();
  const { setSaving, setInfo, setError, reset } = status;

  const runMemberOperation = useCallback(
    async (operation: () => PromiseLike<{ error: { message: string } | null }>, successMessage: string) => {
      if (!supabase || !trip) return;
      setSaving(true);
      reset();
      try {
        const { error } = await operation();
        if (error) setError(error.message);
        else {
          setInfo(successMessage);
          await loadData();
        }
      } catch (opError) {
        setError(opError instanceof Error ? opError.message : "Could not update members.");
      } finally {
        setSaving(false);
      }
    },
    [supabase, trip, loadData, setSaving, reset, setError, setInfo],
  );

  const grantMember = useCallback(
    (input: { email: string; role: MemberRole }) =>
      runMemberOperation(
        () => supabase!.rpc("grant_trip_member_by_email", { target_trip_slug: trip!.slug, target_email: input.email, target_role: input.role }),
        `${input.email} added as ${input.role}.`,
      ),
    [runMemberOperation, supabase, trip],
  );

  const requestAdmin = useCallback(
    () =>
      runMemberOperation(
        () => supabase!.rpc("request_trip_admin", { target_trip_slug: trip!.slug }),
        "Admin request sent. An existing admin will review it.",
      ),
    [runMemberOperation, supabase, trip],
  );

  const setMemberRole = useCallback(
    (targetUserId: string, role: MemberRole) =>
      runMemberOperation(
        () => supabase!.rpc("set_member_role", { target_trip_slug: trip!.slug, target_user_id: targetUserId, new_role: role }),
        role === "admin" ? "Member promoted to admin." : "Member set back to member.",
      ),
    [runMemberOperation, supabase, trip],
  );

  const resolveAdminRequest = useCallback(
    (requestId: string, approve: boolean) =>
      runMemberOperation(
        () => supabase!.rpc("resolve_admin_request", { request_id: requestId, approve }),
        approve ? "Request approved." : "Request denied.",
      ),
    [runMemberOperation, supabase, trip],
  );

  return { status, grantMember, requestAdmin, setMemberRole, resolveAdminRequest };
}
