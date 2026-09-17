"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// The round icon-only control used throughout Journey Mode (close, share,
// prev/next, caption edit...). Always on a dark backdrop, so the styling is
// fixed rather than parameterized like Button.
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  "aria-label": string;
  size?: "sm" | "md";
};

const SIZES = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
};

export function IconButton({ className, size = "md", type = "button", ...props }: Props) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25",
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
