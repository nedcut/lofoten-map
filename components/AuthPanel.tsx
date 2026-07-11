"use client";

import { Loader2, LogIn, Mail, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  message: string | null;
  messageTone: "info" | "error";
  isSubmitting: boolean;
  onSignIn: (email: string) => Promise<void>;
  onSignInWithGoogle: () => Promise<void>;
  onClose: () => void;
};

export function AuthPanel({ message, messageTone, isSubmitting, onSignIn, onSignInWithGoogle, onClose }: Props) {
  async function submit(formData: FormData) {
    const email = String(formData.get("email") ?? "").trim();
    if (email) await onSignIn(email);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/35 p-4 backdrop-blur-sm" onClick={onClose}>
      <form action={submit} onClick={(event) => event.stopPropagation()} className="relative w-full max-w-md rounded-[1.35rem] border border-stone-200/80 bg-[rgba(255,253,246,0.97)] p-5 text-stone-950 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded-full p-1.5 text-stone-500 transition hover:bg-stone-900/10 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50"><X className="h-4 w-4" /></button>
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-teal-50 p-3 text-teal-800"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <h2 className="font-serif text-2xl font-semibold">Sign in to Lofoten</h2>
            <p className="text-sm leading-6 text-stone-600">Viewing is open to everyone — sign in with an invited account to add or edit.</p>
          </div>
        </div>
        <button type="button" disabled={isSubmitting} onClick={onSignInWithGoogle} className="mb-4 flex w-full items-center justify-center gap-3 rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-black text-stone-900 shadow-sm transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Continue with Google
        </button>
        <div className="mb-4 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.12em] text-stone-400">
          <span className="h-px flex-1 bg-stone-200" /> Or use email <span className="h-px flex-1 bg-stone-200" />
        </div>
        <label className="mb-3 block text-sm font-bold text-stone-800" htmlFor="email">Email</label>
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-3">
          <Mail className="h-4 w-4 text-teal-800" />
          <input id="email" name="email" type="email" required placeholder="you@example.com" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400" />
        </div>
        {message ? (
          <div className={cn("mb-3 rounded-lg border p-3 text-sm", messageTone === "error" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-teal-700/20 bg-teal-50 text-teal-950")}>
            {message}
          </div>
        ) : null}
        <button disabled={isSubmitting} className="w-full rounded-lg bg-[#e7a13d] px-4 py-3 font-black text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] transition-all duration-150 hover:bg-[#f0ae4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/40 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50">
          {isSubmitting ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <LogIn className="mr-2 inline h-4 w-4" />} Send sign-in link
        </button>
      </form>
    </div>
  );
}
