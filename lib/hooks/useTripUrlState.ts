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
 * Owns the two pieces of selection state that live in the URL: the selected
 * day (`?day=`) and the item open in the editor (`?item=`). Writes them back
 * on change, applies them once after the first data load, and re-applies them
 * on browser back/forward so history navigation restores the same view.
 */
export function useTripUrlState({ data, allJourneyItems, loading, onJourneyFromUrl }: UseTripUrlStateOptions) {
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  const [editTargetRef, setEditTargetRef] = useState<MapItemRef | null>(null);
  const [deepLinkChecked, setDeepLinkChecked] = useState(false);

  const selectDay = useCallback((dayId: string | null) => {
    setSelectedDayId(dayId);
    if (typeof window === "undefined") return;
    applyTripUrlState(window.location.href, { day: formatDayParam(dayId, data.days) });
  }, [data.days]);

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
    const { day, journey, item } = readTripUrlState(href);
    setSelectedDayId(resolveDayParam(day, data.days));

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
    editTargetRef,
    openEditItem,
    closeEditItem,
  };
}
