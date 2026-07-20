"use client";

import { useCallback, useState } from "react";
import type { BackendClient, BackendUser } from "@/lib/backend";
import type { Trip, TripMember } from "@/types/trip";
import { prepareAvatarFile } from "@/lib/avatar-processing";
import { AVATAR_BUCKET, deleteObjects, IMMUTABLE_CACHE_SECONDS, uploadObject } from "@/lib/object-store";

interface Options {
  backend: BackendClient | null;
  user: BackendUser | null;
  /** The signed-in user's membership row, for the current avatar path. */
  currentMember: Pick<TripMember, "avatar_path"> | null;
  trip: Trip | null;
  loadData: () => Promise<void>;
  /** Surface a failure on the global status pill. */
  onError: (message: string) => void;
  /** Surface success on the global status pill. */
  onNotice: (message: string) => void;
  /** Called once the profile has saved, so the panel can close. */
  onSaved: () => void;
}

/**
 * Saves the signed-in member's display name and avatar. Avatar handling has two
 * write paths — uploading a new file or explicitly removing the current one —
 * and otherwise leaves the stored avatar untouched. The new file is keyed on the
 * user id (to satisfy the storage RLS policy) with a fresh uuid (to bust the CDN
 * cache), and the previous avatar is best-effort cleaned up. Demo mode has no
 * profiles, so this is backend-only.
 */
export function useProfile({ backend, user, currentMember, trip, loadData, onError, onNotice, onSaved }: Options) {
  const [isSaving, setIsSaving] = useState(false);

  const saveProfile = useCallback(
    async (input: { displayName: string; avatarFile: File | null; removeAvatar: boolean }) => {
      if (!backend || !trip || !user) return;
      setIsSaving(true);
      try {
        // Default to whatever avatar the member already has; only the two write
        // paths below (new upload / explicit removal) change it.
        let avatarPath: string | null = currentMember?.avatar_path ?? null;
        let newlyUploadedPath: string | null = null;
        if (input.avatarFile) {
          const prepared = await prepareAvatarFile(input.avatarFile);
          const path = `${user.id}/${crypto.randomUUID()}.jpg`;
          const { error: uploadError } = await uploadObject(backend, AVATAR_BUCKET, path, prepared, {
            cacheControl: IMMUTABLE_CACHE_SECONDS,
            contentType: prepared.type || "image/jpeg",
          });
          if (uploadError) {
            onError(`Could not upload your photo. ${uploadError.message}`);
            return;
          }
          avatarPath = path;
          newlyUploadedPath = path;
        } else if (input.removeAvatar) {
          avatarPath = null;
        }

        const { error: rpcError } = await backend.rpc("update_my_trip_profile", {
          target_trip_slug: trip.slug,
          new_display_name: input.displayName,
          new_avatar_path: avatarPath,
        });
        if (rpcError) {
          // Roll back the newly uploaded file — the DB was never updated to point at it.
          if (newlyUploadedPath) await deleteObjects(backend, AVATAR_BUCKET, [newlyUploadedPath]);
          onError(`Could not save your profile. ${rpcError.message}`);
          return;
        }

        // RPC succeeded — safe to clean up the previous avatar now.
        const previousPath = currentMember?.avatar_path ?? null;
        // A migrated legacy avatar may live below an old Supabase UUID rather
        // than the current Neon subject. After the RPC swaps the membership
        // path, the server can no longer prove that old key belongs to this
        // user, so retain it for the audited orphan sweep instead of broadening
        // delete authorization.
        if (previousPath?.startsWith(`${user.id}/`) && (newlyUploadedPath || input.removeAvatar)) {
          await deleteObjects(backend, AVATAR_BUCKET, [previousPath]);
        }
        await loadData();
        onNotice("Profile updated.");
        onSaved();
      } catch (saveError) {
        onError(saveError instanceof Error ? saveError.message : "Could not save your profile.");
      } finally {
        setIsSaving(false);
      }
    },
    [backend, trip, user, currentMember, loadData, onError, onNotice, onSaved],
  );

  return { isSaving, saveProfile };
}
