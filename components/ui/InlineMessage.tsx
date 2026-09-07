"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The rose/teal status box used for form feedback (AuthPanel, DaySidebar's
// member-admin panels, AdminDataPanel). "info" leans on the fjord palette so
// it reads as part of the app rather than a generic alert.
export function InlineMessage({ tone = "info", className, children }: { tone?: "info" | "error"; className?: string; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[var(--radius-control)] border px-3 py-2 text-sm leading-5",
        tone === "error" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-teal-700/15 bg-teal-50 text-teal-950",
        className,
      )}
    >
      {children}
    </div>
  );
}
