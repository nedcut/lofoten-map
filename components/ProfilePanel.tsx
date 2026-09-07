"use client";

import { Loader2, Trash2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Panel, PanelHeader } from "@/components/ui/Panel";

type Props = {
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: { displayName: string; avatarFile: File | null; removeAvatar: boolean }) => Promise<void>;
};

export function ProfilePanel({ displayName, avatarUrl, email, isSaving, onClose, onSave }: Props) {
  const [name, setName] = useState(displayName ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke the object URL we created for the chosen file when it changes or the
  // panel unmounts, so we don't leak blob URLs.
  /* eslint-disable react-hooks/set-state-in-effect -- syncs a derived blob-URL preview to the chosen file (browser object-URL lifecycle); intentional. */
  useEffect(() => {
    if (!avatarFile) {
      setLocalPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function pickFile(file: File | null) {
    if (!file) return;
    setAvatarFile(file);
    setRemoveAvatar(false);
  }

  function clearAvatar() {
    setAvatarFile(null);
    setRemoveAvatar(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const shownAvatar = localPreview ?? (removeAvatar ? null : avatarUrl);
  const placeholder = email || "Friend";

  async function submit() {
    await onSave({ displayName: name.trim(), avatarFile, removeAvatar });
  }

  return (
    <Panel className="md:w-96">
      <PanelHeader id="profile-panel-title" title="Your profile" subtitle="Set how your name and photo appear on this trip." onClose={onClose} closeLabel="Close profile panel" />
      <form action={submit} aria-labelledby="profile-panel-title" className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-stone-300 bg-stone-100">
            {shownAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownAvatar} alt="" className="h-full w-full object-cover" />
            ) : (
              <UserRound className="h-9 w-9 text-stone-400" />
            )}
          </div>
          <div className="space-y-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-[var(--radius-control)] border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/15">
              Choose photo
            </button>
            {shownAvatar ? (
              <button type="button" onClick={clearAvatar} className="flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-rose-700">
                <Trash2 className="h-3.5 w-3.5" /> Remove photo
              </button>
            ) : null}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />
          </div>
        </div>
        <Field label="Display name" hint={`Leave blank to fall back to ${placeholder}.`}>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder={placeholder} />
        </Field>
        <Button disabled={isSaving} className="w-full">
          {isSaving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : null} Save profile
        </Button>
      </form>
    </Panel>
  );
}
