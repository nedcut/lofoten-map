"use client";

import { KeyRound, Loader2, LogIn, Mail, ShieldCheck, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import { InlineMessage } from "@/components/ui/InlineMessage";
import { useDialogFocus } from "@/lib/hooks/useDialogFocus";

type Props = {
  tripTitle?: string | null;
  message: string | null;
  messageTone: "info" | "error";
  isSubmitting: boolean;
  /** Email that was sent a one-time code; when set the panel asks for that code. */
  pendingOtpEmail?: string | null;
  onSignIn: (email: string) => Promise<void>;
  onVerifyCode?: (code: string) => Promise<void>;
  onCancelCodeEntry?: () => void;
  onSignInWithGoogle: () => Promise<void>;
  onClose: () => void;
};

export function AuthPanel({ tripTitle, message, messageTone, isSubmitting, pendingOtpEmail = null, onSignIn, onVerifyCode, onCancelCodeEntry, onSignInWithGoogle, onClose }: Props) {
  const containerRef = useRef<HTMLFormElement | null>(null);
  useDialogFocus(containerRef, { onClose });
  const awaitingCode = Boolean(pendingOtpEmail && onVerifyCode);

  async function submit(formData: FormData) {
    if (awaitingCode) {
      const code = String(formData.get("code") ?? "").replace(/\s+/g, "");
      if (code) await onVerifyCode?.(code);
      return;
    }
    const email = String(formData.get("email") ?? "").trim();
    if (email) await onSignIn(email);
  }

  if (awaitingCode) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/35 p-4 backdrop-blur-sm" onClick={onClose}>
        <form ref={containerRef} action={submit} role="dialog" aria-modal="true" aria-labelledby="auth-panel-title" onClick={(event) => event.stopPropagation()} className="relative w-full max-w-md rounded-panel border border-stone-200/80 bg-paper/97 p-5 text-stone-950 shadow-2xl">
          <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1.5 text-stone-500 transition hover:bg-stone-900/10 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50"><X className="h-4 w-4" /></button>
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-lg bg-teal-50 p-3 text-teal-800"><KeyRound className="h-5 w-5" /></div>
            <div>
              <h2 id="auth-panel-title" className="font-serif text-2xl font-semibold">Enter your code</h2>
              <p className="text-sm leading-6 text-stone-600">We sent a 6-digit code to <span className="font-bold text-stone-800">{pendingOtpEmail}</span>.</p>
            </div>
          </div>
          <label className="mb-3 block text-sm font-bold text-stone-800" htmlFor="code">Code</label>
          <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-stone-300 bg-white px-4 py-3">
            <KeyRound className="h-4 w-4 text-teal-800" />
            <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus placeholder="123456" className="min-w-0 flex-1 bg-transparent text-sm tracking-[0.3em] outline-none placeholder:tracking-normal placeholder:text-stone-400" />
          </div>
          {message ? <InlineMessage tone={messageTone} className="mb-3">{message}</InlineMessage> : null}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <LogIn className="h-4 w-4" />} Verify code
          </Button>
          <button type="button" disabled={isSubmitting} onClick={onCancelCodeEntry} className="mt-3 w-full text-center text-sm font-bold text-stone-600 underline-offset-4 transition hover:text-stone-900 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 disabled:opacity-50">
            Use a different email
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <form ref={containerRef} action={submit} role="dialog" aria-modal="true" aria-labelledby="auth-panel-title" onClick={(event) => event.stopPropagation()} className="relative w-full max-w-md rounded-panel border border-stone-200/80 bg-paper/97 p-5 text-stone-950 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1.5 text-stone-500 transition hover:bg-stone-900/10 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50"><X className="h-4 w-4" /></button>
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-teal-50 p-3 text-teal-800"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <h2 id="auth-panel-title" className="font-serif text-2xl font-semibold">Sign in to {tripTitle || "this trip"}</h2>
            <p className="text-sm leading-6 text-stone-600">Viewing is open to everyone — sign in with an invited account to add or edit.</p>
          </div>
        </div>
        <button type="button" disabled={isSubmitting} onClick={onSignInWithGoogle} className="mb-4 flex w-full items-center justify-center gap-3 rounded-[var(--radius-control)] border border-stone-300 bg-white px-4 py-3 text-sm font-black text-stone-900 shadow-sm transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
          {isSubmitting ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <LogIn className="h-4 w-4" />} Continue with Google
        </button>
        <div className="mb-4 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.12em] text-stone-400">
          <span className="h-px flex-1 bg-stone-200" /> Or use email <span className="h-px flex-1 bg-stone-200" />
        </div>
        <label className="mb-3 block text-sm font-bold text-stone-800" htmlFor="email">Email</label>
        <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-stone-300 bg-white px-4 py-3">
          <Mail className="h-4 w-4 text-teal-800" />
          <input id="email" name="email" type="email" required placeholder="you@example.com" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400" />
        </div>
        {message ? <InlineMessage tone={messageTone} className="mb-3">{message}</InlineMessage> : null}
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" /> : <LogIn className="h-4 w-4" />} Send sign-in link
        </Button>
      </form>
    </div>
  );
}
