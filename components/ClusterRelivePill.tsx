"use client";

import { Play, X } from "lucide-react";
import { useEffect } from "react";
import type { Photo } from "@/types/trip";

type Props = {
  photos: Photo[];
  onRelive: () => void;
  onDismiss: () => void;
};

function groupLabel(photos: Photo[]) {
  const videos = photos.filter((photo) => photo.media_type === "video").length;
  const noun = videos === 0 ? (photos.length === 1 ? "photo" : "photos") : videos === photos.length ? (videos === 1 ? "video" : "videos") : "photos & videos";
  return `${photos.length} ${noun} here`;
}

// Offered after a photo-cluster tap zooms in: one tap to relive the group.
// It sits above the phone bottom sheet (whose height MobileSheet publishes)
// and stays put until the user moves on rather than timing out.
export function ClusterRelivePill({ photos, onRelive, onDismiss }: Props) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="absolute bottom-[calc(var(--mobile-sheet-height,10rem)+0.75rem)] left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-stone-200/80 bg-paper/94 py-1 pl-4 pr-1 text-sm text-stone-800 shadow-control backdrop-blur motion-safe:animate-[lofoten-photo-marker-in_180ms_ease-out] md:bottom-6"
    >
      <span className="truncate font-semibold">{groupLabel(photos)}</span>
      <button
        type="button"
        onClick={onRelive}
        className="ml-2 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-stone-900 px-4 text-xs font-bold text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/60 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 md:h-8"
      >
        <Play className="h-3.5 w-3.5 fill-current text-ember-400" /> Relive
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-900/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/60 md:h-8 md:w-8"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
