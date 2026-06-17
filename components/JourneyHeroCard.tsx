"use client";

import { Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Photo } from "@/types/trip";

type Props = {
  // The full photo set; the card samples a few with usable URLs for the preview.
  photos: Photo[];
  // How many items the journey will play, and across how many days — drives the
  // subtitle ("142 moments across 8 days").
  momentCount: number;
  dayCount: number;
  onPlay: () => void;
  disabled?: boolean;
  // Mobile renders a shorter hero so it doesn't crowd out the day list.
  compact?: boolean;
};

const PREVIEW_COUNT = 4;
const SLIDE_MS = 5000;

function previewUrl(photo: Photo) {
  return photo.thumbnail_url ?? photo.image_url;
}

// Fisher–Yates over a copy — never mutates the source array.
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function JourneyHeroCard({ photos, momentCount, dayCount, onPlay, disabled = false, compact = false }: Props) {
  // Only still photos with a resolved URL are slideshow-worthy (videos have no
  // reliable poster here). Memoised so the shuffle effect's dependency is stable
  // across renders that don't change the photo set.
  const candidates = useMemo(
    () => photos.filter((photo) => photo.media_type === "photo" && previewUrl(photo)),
    [photos],
  );

  const candidateSignature = candidates.map((photo) => `${photo.id}:${previewUrl(photo)}`).join("|");

  // Shuffle is deferred out of render: doing it during render would desync the
  // SSR markup on hydration. Once seeded, preserve the chosen order across data
  // refreshes so unrelated trip updates don't reshuffle the preview mid-session.
  const [preview, setPreview] = useState<Photo[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deferring the random shuffle keeps SSR markup stable through hydration; intentional.
    setPreview((current) => {
      if (candidates.length === 0) return current.length === 0 ? current : [];

      const byId = new Map(candidates.map((photo) => [photo.id, photo]));
      const kept = current
        .map((photo) => byId.get(photo.id))
        .filter((photo): photo is Photo => Boolean(photo));
      if (kept.length >= Math.min(PREVIEW_COUNT, candidates.length)) return kept.slice(0, PREVIEW_COUNT);

      const keptIds = new Set(kept.map((photo) => photo.id));
      const additions = shuffle(candidates.filter((photo) => !keptIds.has(photo.id)));
      return [...kept, ...additions].slice(0, PREVIEW_COUNT);
    });
  }, [candidateSignature, candidates]);

  // The crossfade only runs once the card is actually on screen, so an unseen
  // hero (collapsed mobile sheet, scrolled-away sidebar) costs nothing.
  const containerRef = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Advance the active slide on a timer while visible. Reduced-motion users get
  // a single static frame: the interval simply never starts.
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (preview.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clamps the active slide after realtime preview removals; intentional.
    setActive((current) => (current < preview.length ? current : 0));
  }, [preview.length]);
  useEffect(() => {
    if (!visible || preview.length < 2) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setActive((current) => (current + 1) % preview.length), SLIDE_MS);
    return () => window.clearInterval(id);
  }, [visible, preview.length]);

  const subtitle = momentCount > 0
    ? `${momentCount} moment${momentCount === 1 ? "" : "s"}${dayCount > 0 ? ` across ${dayCount} day${dayCount === 1 ? "" : "s"}` : ""}`
    : "Watch the trip unfold across the map";

  return (
    <button
      ref={containerRef}
      type="button"
      onClick={onPlay}
      disabled={disabled}
      aria-label="Relive the journey"
      className={cn(
        // shrink-0: the slideshow layers are all absolutely positioned, so the
        // button has no intrinsic height — without this, the flex-column sidebar
        // shrinks it to a sliver when its content overflows.
        "group relative w-full shrink-0 overflow-hidden rounded-[1.1rem] border border-stone-200/80 bg-[#0f3b32] text-left text-white shadow-[0_16px_40px_rgba(46,61,54,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_48px_rgba(46,61,54,0.34)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e7a13d]/50 active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60",
        compact ? "h-[112px]" : "h-[150px]",
      )}
    >
      {/* Slideshow frames. Each crossfades via opacity; the active one also drifts
          (Ken Burns) for ambient motion. Decorative, so alt="". */}
      {preview.map((photo, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={photo.id}
          src={previewUrl(photo) ?? undefined}
          alt=""
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-[1200ms] ease-in-out motion-reduce:transition-none",
            index === active ? "opacity-100" : "opacity-0",
            index === active && "journey-hero-kenburns",
          )}
        />
      ))}
      {/* Scrim keeps the label readable over any photo. */}
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(15,40,33,0.15),rgba(15,40,33,0.78))]" aria-hidden />

      {preview.length > 0 ? (
        <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5DCAA5]" /> Live preview
        </span>
      ) : null}

      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-3 p-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e7a13d] text-stone-950 shadow-lg transition-transform duration-200 group-hover:scale-105">
          <Play className="h-5 w-5 fill-current" />
        </span>
        <span className="min-w-0">
          <span className="block font-serif text-lg font-semibold leading-tight">Relive the journey</span>
          <span className="block truncate text-xs text-white/85">{subtitle}</span>
        </span>
      </span>
    </button>
  );
}
