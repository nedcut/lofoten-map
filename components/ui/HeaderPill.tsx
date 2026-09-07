"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// The floating pill chrome shared by the app header: trip title chip, status
// chip, and the Relive/Profile/Sign in/Sign out buttons. `PillButton` is the
// interactive form; `HeaderPill` is the static (non-button) shell for the
// title chip and the status text.
const PILL_BASE = "pointer-events-auto rounded-full border border-stone-200/80 bg-paper/90 shadow-lg backdrop-blur";

export function HeaderPill({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn(PILL_BASE, "px-4 py-2 text-xs font-semibold text-stone-700", className)}>{children}</div>;
}

export function PillButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        PILL_BASE,
        "inline-flex items-center gap-2 px-3 py-2 text-xs font-bold text-stone-700 transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
