"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Shared visual treatment for every text input, textarea and select in the
// app — previously copy-pasted across ~30 call sites.
export const inputClassName = "w-full rounded-[var(--radius-control)] border border-stone-300 bg-white px-4 py-3 text-sm text-stone-950 outline-none placeholder:text-stone-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/15 disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClassName, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClassName, "min-h-24", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return <select className={cn(inputClassName, className)} {...props}>{children}</select>;
}

// Wraps a label + control. `hideLabel` renders the label sr-only for inputs
// that already read fine from a placeholder alone but still need a real
// accessible name (checkbox/radio-style compactness without losing a11y).
export function Field({ label, hint, hideLabel = false, htmlFor, children }: { label: string; hint?: string; hideLabel?: boolean; htmlFor?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5" htmlFor={htmlFor}>
      <span className={cn("block text-sm font-semibold text-stone-700", hideLabel && "sr-only")}>{label}</span>
      {children}
      {hint ? <span className="block text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}
