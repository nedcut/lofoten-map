import { cn } from "@/lib/utils";

// Pure class-string builder, kept out of Button.tsx (a "use client" module) so
// server components — e.g. app/not-found.tsx, which styles a next/link as a
// button — can call it directly instead of importing from a client boundary.
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonTone = "ember" | "fjord";
export type ButtonSize = "sm" | "md";

export type ButtonStyleProps = {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  className?: string;
};

const BASE = "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-black transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

const SIZES: Record<ButtonSize, string> = {
  md: "px-4 py-3",
  sm: "px-3 py-2.5 text-sm",
};

// Every combination actually used across the app. Kept as a flat lookup
// (rather than composing tone + variant fragments) so each cell can carry the
// exact shadow/ring/hover values the site it replaces already had.
const STYLES: Record<ButtonVariant, Record<ButtonTone, string>> = {
  primary: {
    ember: "bg-ember-400 text-stone-950 shadow-[0_12px_24px_rgba(184,106,31,0.22)] hover:bg-ember-300 focus-visible:ring-ember-400/40",
    fjord: "bg-teal-700 text-white hover:bg-teal-800 focus-visible:ring-teal-700/25",
  },
  secondary: {
    ember: "border border-stone-300 bg-white text-stone-800 hover:border-stone-400 hover:bg-stone-50 focus-visible:ring-stone-300/50",
    fjord: "border border-teal-700/25 bg-teal-50 text-teal-950 hover:border-teal-700/40 hover:bg-teal-100 focus-visible:ring-teal-700/20",
  },
  ghost: {
    ember: "bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white/25",
    fjord: "bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white/25",
  },
  danger: {
    ember: "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 focus-visible:ring-rose-200/70",
    fjord: "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 focus-visible:ring-rose-200/70",
  },
};

export function buttonClassName({ variant = "primary", tone = "ember", size = "md", className }: ButtonStyleProps = {}) {
  return cn(BASE, SIZES[size], STYLES[variant][tone], className);
}
