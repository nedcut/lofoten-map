import type { AdminRequest, TripMember } from "@/types/trip";

type AccessInput = {
  backendEnabled: boolean;
  userId: string | null;
  members: TripMember[];
  adminRequests: AdminRequest[];
  /** Shared-backend Vercel previews: keep live data visible, block writes. */
  readOnly?: boolean;
};

export type TripAccessState = {
  currentUserId: string | null;
  currentMember: TripMember | null;
  currentUserAdminRequest: AdminRequest | null;
  pendingAdminRequests: AdminRequest[];
  canContribute: boolean;
  isAdmin: boolean;
  showMemberAdminControls: boolean;
  showAdminRequestControls: boolean;
};

function newestFirst<T extends { created_at: string }>(items: T[]) {
  return [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function deriveTripAccess({ backendEnabled, userId, members, adminRequests, readOnly = false }: AccessInput): TripAccessState {
  const currentMember = userId ? members.find((member) => member.user_id === userId) ?? null : null;
  const isDemoMode = !backendEnabled;
  const previewReadOnly = Boolean(backendEnabled && readOnly);
  const isAdmin = !previewReadOnly && (isDemoMode || currentMember?.role === "admin");
  const canContribute = !previewReadOnly && (isDemoMode || Boolean(currentMember));
  const currentUserAdminRequest = userId
    ? newestFirst(adminRequests.filter((request) => request.user_id === userId))[0] ?? null
    : null;
  const pendingAdminRequests = newestFirst(adminRequests.filter((request) => request.status === "pending"));

  return {
    currentUserId: userId,
    currentMember,
    currentUserAdminRequest,
    pendingAdminRequests,
    canContribute,
    isAdmin,
    showMemberAdminControls: !previewReadOnly && currentMember?.role === "admin",
    showAdminRequestControls: Boolean(!previewReadOnly && backendEnabled && currentMember && currentMember.role !== "admin"),
  };
}
