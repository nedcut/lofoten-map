import type { AdminRequest, TripMember } from "@/types/trip";

type AccessInput = {
  supabaseEnabled: boolean;
  userId: string | null;
  members: TripMember[];
  adminRequests: AdminRequest[];
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

export function deriveTripAccess({ supabaseEnabled, userId, members, adminRequests }: AccessInput): TripAccessState {
  const currentMember = userId ? members.find((member) => member.user_id === userId) ?? null : null;
  const isDemoMode = !supabaseEnabled;
  const isAdmin = isDemoMode || currentMember?.role === "admin";
  const canContribute = isDemoMode || Boolean(currentMember);
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
    showMemberAdminControls: currentMember?.role === "admin",
    showAdminRequestControls: Boolean(supabaseEnabled && currentMember && currentMember.role !== "admin"),
  };
}
