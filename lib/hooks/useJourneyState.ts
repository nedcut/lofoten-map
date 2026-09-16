"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JourneyFilter } from "@/components/JourneyPlayback";
import type { JourneyItem } from "@/lib/journey";
import { applyTripUrlState } from "@/lib/trip-url";

type HistoryMode = "push" | "replace";

type UseJourneyStateOptions = {
  /** Every journey item for the trip, before the viewer's filters. */
  allJourneyItems: JourneyItem[];
};

/**
 * Owns Journey Mode playback state: which item is active, the viewer's
 * type/uploader filters, the intro flag, and the URL sync that keeps the
 * `journey` param and browser history in step with the open viewer.
 */
export function useJourneyState({ allJourneyItems }: UseJourneyStateOptions) {
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);
  const [journeyFilter, setJourneyFilter] = useState<JourneyFilter>("all");
  const [journeyUploaderFilter, setJourneyUploaderFilter] = useState("");
  const [journeyIntro, setJourneyIntro] = useState(false);

  const journeyItems = useMemo(() => allJourneyItems.filter((item) => {
    if (journeyFilter === "photos" && item.kind !== "photo") return false;
    if (journeyFilter === "journal" && item.kind === "photo") return false;
    if (journeyUploaderFilter && (item.kind !== "photo" || item.primary.uploader_name !== journeyUploaderFilter)) return false;
    return true;
  }), [allJourneyItems, journeyFilter, journeyUploaderFilter]);
  const activeJourneyIndex = useMemo(() => {
    if (!activeJourneyId) return -1;
    return journeyItems.findIndex((item) => item.id === activeJourneyId);
  }, [activeJourneyId, journeyItems]);
  const journeyOpen = Boolean(activeJourneyId);

  const openJourneyAt = useCallback((itemId: string, mode: HistoryMode = "push") => {
    setActiveJourneyId(itemId);
    if (typeof window === "undefined") return;
    applyTripUrlState(window.location.href, { journey: itemId, item: null }, mode);
  }, []);

  const closeJourney = useCallback(() => {
    setActiveJourneyId(null);
    if (typeof window === "undefined") return;
    applyTripUrlState(window.location.href, { journey: null });
  }, []);

  // Adopt the journey item named by the URL (deep link or history navigation).
  // The URL already holds the value, so this only updates state. A photo deep
  // link clears the filters so the photo is guaranteed to be in the sequence.
  const restoreJourneyFromUrl = useCallback((itemId: string | null, options?: { resetFilters?: boolean }) => {
    setJourneyIntro(false);
    if (options?.resetFilters) {
      setJourneyFilter("all");
      setJourneyUploaderFilter("");
    }
    setActiveJourneyId(itemId);
  }, []);

  const selectJourneyIndex = useCallback((index: number) => {
    const item = journeyItems[index];
    if (!item) return;
    openJourneyAt(item.id, "replace");
  }, [journeyItems, openJourneyAt]);

  // Tapping a dot in the journey mini-map jumps straight to that item.
  const selectJourneyItem = useCallback((id: string) => {
    openJourneyAt(id, "replace");
  }, [openJourneyAt]);

  const nextJourneyItem = useCallback(() => {
    if (journeyItems.length === 0) return;
    const currentIndex = activeJourneyIndex >= 0 ? activeJourneyIndex : 0;
    const nextIndex = (currentIndex + 1) % journeyItems.length;
    selectJourneyIndex(nextIndex);
  }, [activeJourneyIndex, journeyItems.length, selectJourneyIndex]);

  const prevJourneyItem = useCallback(() => {
    if (journeyItems.length === 0) return;
    const currentIndex = activeJourneyIndex >= 0 ? activeJourneyIndex : 0;
    const nextIndex = (currentIndex - 1 + journeyItems.length) % journeyItems.length;
    selectJourneyIndex(nextIndex);
  }, [activeJourneyIndex, journeyItems.length, selectJourneyIndex]);

  // Opening Journey Mode from a main-map photo popup. Clear any active filters so
  // the chosen photo is guaranteed to be in the sequence, and push history so the
  // browser back button exits playback.
  const openJourneyFromMap = useCallback((photoId: string) => {
    setJourneyIntro(false);
    setJourneyFilter("all");
    setJourneyUploaderFilter("");
    openJourneyAt(`photo:${photoId}`, "push");
  }, [openJourneyAt]);

  // "Play this day" from a day card: clear any active filters so the day's first
  // moment is guaranteed to be in the sequence, then drop into playback there.
  const playDayJourney = useCallback((dayId: string) => {
    setJourneyIntro(false);
    setJourneyFilter("all");
    setJourneyUploaderFilter("");
    const first = allJourneyItems.find((item) => item.dayId === dayId);
    if (first) openJourneyAt(first.id, "push");
  }, [allJourneyItems, openJourneyAt]);

  useEffect(() => {
    if (!activeJourneyId) return;
    if (journeyItems.some((item) => item.id === activeJourneyId)) return;
    // The active item dropped out of the filtered list. If others still match,
    // snap to the first of them. If the list is now empty but the item still
    // exists overall, the user just narrowed a filter past everything — keep the
    // viewer open so its filter controls stay reachable. Only close when the
    // item is genuinely gone (e.g. deleted via realtime) with nothing left.
    // Stays an effect (rather than a derived value) because it also rewrites
    // the URL's `journey` param, which is an external system.
    if (journeyItems[0]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciles the active journey item when filters/realtime drop it from the list; intentional.
      openJourneyAt(journeyItems[0].id, "replace");
    } else if (!allJourneyItems.some((item) => item.id === activeJourneyId)) {
      closeJourney();
    }
  }, [activeJourneyId, allJourneyItems, closeJourney, journeyItems, openJourneyAt]);

  return {
    activeJourneyId,
    /** Direct setter for callers that leave the viewer without touching the URL. */
    setActiveJourneyId,
    activeJourneyIndex,
    journeyOpen,
    journeyItems,
    journeyFilter,
    setJourneyFilter,
    journeyUploaderFilter,
    setJourneyUploaderFilter,
    journeyIntro,
    setJourneyIntro,
    openJourneyAt,
    closeJourney,
    restoreJourneyFromUrl,
    selectJourneyIndex,
    selectJourneyItem,
    nextJourneyItem,
    prevJourneyItem,
    openJourneyFromMap,
    playDayJourney,
  };
}
