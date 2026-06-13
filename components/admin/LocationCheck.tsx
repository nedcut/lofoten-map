"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, X } from "lucide-react";
import { photoLabel } from "@/components/admin/editors";
import type { PhotoOutlier } from "@/lib/photo-outliers";
import { cn } from "@/lib/utils";

// The "Location check" admin section body: photos placed far from where their
// time-neighbors were taken, with map-preview wiring for hover/pin.

function formatOffset(km: number) {
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`;
}

// A flagged photo with its evidence and the two ways to resolve it: snap it
// to where its time-neighbors were taken, or dismiss the flag (per session —
// some photos legitimately stray, e.g. a zoomed shot of a distant peak).
// Hovering previews the photo and its group on the map; clicking pins the
// preview and frames the map around it.
function OutlierRow({ outlier, isSaving, pinned, onMove, onDismiss, onHover, onSelect }: { outlier: PhotoOutlier; isSaving: boolean; pinned: boolean; onMove: () => Promise<void>; onDismiss: () => void; onHover: (hovering: boolean) => void; onSelect: () => void }) {
  const { photo } = outlier;
  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onSelect}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }}
      className={cn(
        "grid cursor-pointer grid-cols-[3rem_minmax(0,1fr)] gap-2 rounded-lg border bg-amber-50/70 p-2 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400/30",
        pinned ? "border-amber-500 ring-2 ring-amber-400/40" : "border-amber-300/60 hover:border-amber-400",
      )}
    >
      <div className="h-12 overflow-hidden rounded-md bg-stone-100">
        {photo.thumbnail_url || photo.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Existing remote URLs come from user uploads.
          <img src={photo.thumbnail_url ?? photo.image_url ?? ""} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] font-bold text-stone-500">{photo.media_type === "video" ? "Video" : "Photo"}</div>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="truncate text-sm font-semibold text-stone-900">{photoLabel(photo)}</div>
        <div className="text-xs leading-4 text-stone-600">
          {formatOffset(outlier.distanceKm)} away from the {outlier.neighborCount} photos taken within {outlier.windowMinutes} min of it
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={isSaving}
            onClick={(event) => { event.stopPropagation(); void onMove(); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />} Move to group
          </button>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onDismiss(); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-bold text-stone-600 transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-stone-300/50 active:scale-[0.98]"
          >
            <X className="h-3.5 w-3.5" /> Looks right
          </button>
        </div>
      </div>
    </div>
  );
}

// The flagged-photo rows plus their map-preview state: hovering shows a row's
// photo and group on the map, clicking pins it (and frames the map). Pinning
// and the unmount cleanup live here so a closed section always clears the map.
export function LocationCheckList({ outliers, isSaving, onMove, onDismiss, onPreview }: {
  outliers: PhotoOutlier[];
  isSaving: boolean;
  onMove: (outlier: PhotoOutlier) => Promise<void>;
  onDismiss: (outlier: PhotoOutlier) => void;
  onPreview: (outlier: PhotoOutlier | null, options?: { focus?: boolean }) => void;
}) {
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const pinned = pinnedId ? outliers.find((outlier) => outlier.photo.id === pinnedId) ?? null : null;
  const previewRef = useRef(onPreview);
  useEffect(() => {
    previewRef.current = onPreview;
  }, [onPreview]);
  // Clear the overlay when the section closes (LazyDetails unmounts children).
  useEffect(() => () => previewRef.current(null), []);
  // ...and when the pinned outlier resolves (moved or list recomputed).
  /* eslint-disable react-hooks/set-state-in-effect -- clears the pin once the pinned outlier resolves away (derived cleanup); intentional. */
  useEffect(() => {
    if (pinnedId && !pinned) {
      setPinnedId(null);
      previewRef.current(null);
    }
  }, [pinned, pinnedId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <>
      {outliers.map((outlier) => (
        <OutlierRow
          key={outlier.photo.id}
          outlier={outlier}
          isSaving={isSaving}
          pinned={outlier.photo.id === pinnedId}
          onHover={(hovering) => onPreview(hovering ? outlier : pinned)}
          onSelect={() => {
            setPinnedId(outlier.photo.id);
            onPreview(outlier, { focus: true });
          }}
          onMove={async () => {
            setPinnedId(null);
            onPreview(null);
            await onMove(outlier);
          }}
          onDismiss={() => {
            setPinnedId(null);
            onPreview(null);
            onDismiss(outlier);
          }}
        />
      ))}
    </>
  );
}
