"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  tone?: "info" | "error";
  onDismiss?: () => void;
};

export function StatusPill({ children, tone = "info", onDismiss }: Props) {
  return (
    <div
      role="status"
      className={cn(
        "fixed left-1/2 top-16 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-xl backdrop-blur",
        tone === "error" ? "border-rose-200 bg-rose-50/95 text-rose-900" : "border-stone-200/80 bg-[rgba(255,253,246,0.94)] text-stone-800",
      )}
    >
      {children}
      {onDismiss ? <button onClick={onDismiss} className="-mr-1 ml-1 rounded-full p-1 text-current/70 transition hover:bg-stone-900/10" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button> : null}
    </div>
  );
}
