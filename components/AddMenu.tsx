"use client";

import { Plus, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { PillButton } from "@/components/ui/HeaderPill";
import { cn } from "@/lib/utils";

export type AddAction = { key: string; label: string; hint: string; icon: LucideIcon; onSelect: () => void };

// The contributor tools (upload, note, route) behind one header button, so
// the sidebar and the phone sheet lead with the trip rather than with editing.
// A lone action (e.g. only uploads, while the map is unavailable) skips the
// menu and is the button itself.
export function AddMenu({ actions }: { actions: AddAction[] }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      if (items.length === 0) return;
      event.preventDefault();
      // Capture phase: keep the arrows from also stepping the day filter.
      event.stopPropagation();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (actions.length === 0) return null;
  if (actions.length === 1) {
    const [action] = actions;
    const Icon = action.icon;
    return (
      <PillButton onClick={action.onSelect} aria-label={action.label}>
        <Icon className="h-3.5 w-3.5 text-ember-600" /> <span className="hidden sm:inline">{action.label}</span>
      </PillButton>
    );
  }

  return (
    <div className="pointer-events-auto relative">
      <PillButton
        ref={buttonRef}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Add to the logbook"
        className={cn(open && "bg-white shadow-md")}
      >
        <Plus className={cn("h-3.5 w-3.5 text-ember-600 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-45")} /> <span className="hidden sm:inline">Add</span>
      </PillButton>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Add to the logbook"
          className="absolute right-0 top-[calc(100%+0.5rem)] w-64 origin-top-right rounded-2xl border border-stone-200/80 bg-paper/96 p-1.5 shadow-panel backdrop-blur-xl lofoten-menu-in"
        >
          {actions.map(({ key, label, hint, icon: Icon, onSelect }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-paper-tint focus-visible:bg-paper-tint focus-visible:outline-none"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#fbe7c6] text-ember-700"><Icon className="h-4 w-4" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-stone-900">{label}</span>
                <span className="block text-xs text-stone-500">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
