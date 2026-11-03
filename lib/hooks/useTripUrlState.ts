"use client";

import { useCallback, useEffect, useState } from "react";
import type { JourneyItem } from "@/lib/journey";
import { applyTripUrlState, formatDayParam, formatItemToken, parseItemToken, readTripUrlState, resolveDayParam } from "@/lib/trip-url";
import type { MapItemRef } from "@/lib/trip-url";
import type { TripData } from "@/types/trip";

type UseTripUrlStateOptions = {
  data: TripData;
  /** Every journey item for the trip; used to validate a `journey` deep link. */
  allJourneyItems: JourneyItem[];
  /** True until the first data load finishes; deep links wait for it. */
  loading: boolean;
  /**
   * Called whenever the URL is (re)applied, with the journey item it names or
   * null. `resetFilters` is set when a photo deep link should clear the
   * viewer's filters so the photo is guaranteed to be in the sequence.
   */
  onJourneyFromUrl: (itemId: string | null, options: { resetFilters: boolean }) => void;
};

/**
 * Owns the selection state that lives in the URL: the selected day
 * (`?day=`), whether that day is open as a story (`?story=1`), and the item
 * open in the editor (`?item=`). Writes them back
 * on change, applies them once after the first data load, and re-applies them
 * on browser back/forward so history navigation restores the same view.
 */
export function useTripUrlState({ data, allJourneyItems, loading, onJourneyFromUrl }: UseTripUrlStateOptions) {
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [editTargetRef, setEditTargetRef] = useState<MapItemRef | null>(null);
  const [deepLinkChecked, setDeepLinkChecked] = useState(false);

  // A story is always of one day, so "All days" also closes it; stepping to
  // another day keeps reading.
  const selectDay = useCallback((dayId: string | null) => {
    setSelectedDayId(dayId);
    if (!dayId) setStoryOpen(false);
    if (typeof window === "undefined") return;
    // Keep `story=1` only while a story is actually open; a flag the page
    // ignored (no day named) must not turn into a story link on reload.
    applyTripUrlState(window.location.href, { day: formatDayParam(dayId, data.days), ...(dayId && storyOpen ? {} : { story: null }) });
  }, [data.days, storyOpen]);

  // Opening a story pushes history so the back button returns to the map.
  const openStory = useCallback((dayId: string) => {
    setSelectedDayId(dayId);
    setStoryOpen(true);
    applyTripUrlState(window.location.href, { day: formatDayParam(dayId, data.days), story: "1", journey: null }, "push");
  }, [data.days]);

  const closeStory = useCallback(() => {
    setStoryOpen(false);
    applyTripUrlState(window.location.href, { story: null });
  }, []);

  // Opening an item's editor pushes history so the back button closes it, and
  // clears any journey param since the editor replaces the viewer.
  const openEditItem = useCallback((kind: MapItemRef["kind"], id: string) => {
    setEditTargetRef({ kind, id });
    applyTripUrlState(window.location.href, { item: formatItemToken({ kind, id }), journey: null }, "push");
  }, []);

  const closeEditItem = useCallback(() => {
    setEditTargetRef(null);
    applyTripUrlState(window.location.href, { item: null });
  }, []);

  const applyDeepLinkFromUrl = useCallback((href: string) => {
    const { day, journey, item, story } = readTripUrlState(href);
    const dayId = resolveDayParam(day, data.days);
    setSelectedDayId(dayId);
    setStoryOpen(story === "1" && dayId !== null);

    const journeyToken = journey && allJourneyItems.some((entry) => entry.id === journey) ? journey : null;
    const itemRef = parseItemToken(item);
    if (!itemRef) {
      onJourneyFromUrl(journeyToken, { resetFilters: false });
      setEditTargetRef(null);
      return;
    }
    // A photo item opens in Journey Mode rather than the editor, and it wins
    // over any journey param already in the URL.
    if (itemRef.kind === "photo" && data.photos.some((entry) => entry.id === itemRef.id)) {
      onJourneyFromUrl(`photo:${itemRef.id}`, { resetFilters: true });
      setEditTargetRef(null);
      return;
    }
    onJourneyFromUrl(journeyToken, { resetFilters: false });
    const exists = (
      (itemRef.kind === "note" && data.notes.some((entry) => entry.id === itemRef.id))
      || (itemRef.kind === "place" && data.places.some((entry) => entry.id === itemRef.id))
      || (itemRef.kind === "route" && data.routeSegments.some((entry) => entry.id === itemRef.id))
    );
    setEditTargetRef(exists ? { kind: itemRef.kind, id: itemRef.id } : null);
  }, [allJourneyItems, data.days, data.notes, data.photos, data.places, data.routeSegments, onJourneyFromUrl]);

  /* eslint-disable react-hooks/set-state-in-effect -- one-shot sync of selection state from the URL (external system) after the first data load; intentional. */
  useEffect(() => {
    if (deepLinkChecked || loading) return;
    applyDeepLinkFromUrl(window.location.href);
    setDeepLinkChecked(true);
  }, [applyDeepLinkFromUrl, deepLinkChecked, loading]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const handler = () => applyDeepLinkFromUrl(window.location.href);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [applyDeepLinkFromUrl]);

  return {
    selectedDayId,
    selectDay,
    storyOpen,
    openStory,
    closeStory,
    editTargetRef,
    openEditItem,
    closeEditItem,
  };
}
