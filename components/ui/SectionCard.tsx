"use client";

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

// The "icon + label header, boxed body" pattern repeated across the sidebar's
// admin sections (Layers, Members, Admin access, Admin data).
export function SectionCard({ icon: Icon, title, className, children }: { icon: ComponentType<{ className?: string }>; title: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("space-y-3 rounded-[var(--radius-panel)] border border-stone-200 bg-white/75 p-4", className)}>
      <div className="flex items-center gap-2 text-sm font-bold text-stone-900">
        <Icon className="h-4 w-4 text-teal-700" /> {title}
      </div>
      {children}
    </section>
  );
}
