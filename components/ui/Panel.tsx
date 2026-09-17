"use client";

import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useDialogFocus } from "@/lib/hooks/useDialogFocus";
import { cn } from "@/lib/utils";

// The bottom-right floating panel shell shared by AddNotePanel, EditItemPanel
// and ProfilePanel (previously three copies of the same markup). Positioning
// utilities (inset-x-3 bottom-3 ... md:w-96) stay with each call site since
// widths differ; this owns the box treatment only.
//
// `labelledBy` should match the `id` given to this panel's PanelHeader, and
// `onClose` wires up initial focus, a Tab trap, Escape-to-close, and focus
// restoration on close via useDialogFocus. Panels that need the map while
// open (placing a note, drawing a route) pass `modal={false}`: they keep
// Escape and focus restore but do not trap Tab or hide the page from
// assistive technology.
export function Panel({ className, children, labelledBy, onClose, modal = true }: { className?: string; children: ReactNode; labelledBy?: string; onClose?: () => void; modal?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(containerRef, { onClose, trapFocus: modal });
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal={modal ? "true" : undefined}
      aria-labelledby={labelledBy}
      className={cn(
        "pointer-events-auto fixed inset-x-3 bottom-3 z-30 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-panel border border-stone-200/80 bg-paper/96 text-stone-950 shadow-panel backdrop-blur-xl md:bottom-6 md:left-auto md:right-6",
        className,
      )}
    >
      <div className="flex max-h-[calc(100dvh-1.5rem)] flex-col p-4">{children}</div>
    </div>
  );
}

// title/subtitle + close button, wired for a11y so a later focus-management
// pass has one place to add a focus trap.
export function PanelHeader({ id, title, subtitle, onClose, closeLabel = "Close" }: { id: string; title: string; subtitle?: string; onClose: () => void; closeLabel?: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 id={id} className="font-serif text-2xl font-semibold tracking-tight">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm leading-5 text-stone-600">{subtitle}</p> : null}
      </div>
      <button onClick={onClose} className="rounded-full p-2 text-stone-500 hover:bg-stone-900/5" aria-label={closeLabel}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
