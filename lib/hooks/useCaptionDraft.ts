"use client";

import { useEffect, useState } from "react";
import type { JourneyItem } from "@/lib/journey";

/**
 * Journey Mode's caption editor state. Resets when the viewer moves to another
 * item or that item's saved caption changes. Keyed on the id and caption, not
 * the item object: buildJourneyItems rebuilds every item whenever any trip
 * data changes (a poll, someone else's upload), which would wipe a draft.
 */
export function useCaptionDraft(activeItem: JourneyItem | undefined) {
  const [captionDraft, setCaptionDraft] = useState("");
  const [editingCaption, setEditingCaption] = useState(false);
  const activeItemId = activeItem?.id ?? null;
  const savedCaption = activeItem?.kind === "photo" ? activeItem.primary.caption ?? "" : "";

  /* eslint-disable react-hooks/set-state-in-effect -- resets the caption editor to mirror the active item (external selection); intentional sync, not a render cascade. */
  useEffect(() => {
    setCaptionDraft(savedCaption);
    setEditingCaption(false);
  }, [activeItemId, savedCaption]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { captionDraft, setCaptionDraft, editingCaption, setEditingCaption };
}
