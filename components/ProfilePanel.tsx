"use client";

import { Loader2, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  useEffect(() => {
    if (!avatarFile) {
      setLocalPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

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
    <div className="pointer-events-auto fixed inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.96)] text-stone-950 shadow-[0_24px_80px_rgba(46,61,54,0.22)] backdrop-blur-xl md:bottom-6 md:left-auto md:right-6 md:w-96">
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-semibold tracking-tight">Your profile</h2>
            <p className="mt-1 text-sm leading-5 text-stone-600">Set how your name and photo appear on this trip.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-stone-500 hover:bg-stone-900/5" aria-label="Close profile panel"><X className="h-4 w-4" /></button>
        </div>
        <form action={submit} className="min-h-0 space-y-4 overflow-y-auto pr-1">
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
              <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/15">
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
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-stone-700">Display name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder={placeholder} className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15" />
            <span className="text-xs text-stone-500">Leave blank to fall back to {placeholder}.</span>
          </label>
          <button disabled={isSaving} className="w-full rounded-lg bg-[#e7a13d] px-4 py-3 font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
            {isSaving ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null} Save profile
          </button>
        </form>
      </div>
    </div>
  );
}
