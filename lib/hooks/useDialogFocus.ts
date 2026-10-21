"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

// Shared focus-management for the app's overlay dialogs (panels, the auth
// modal, Journey Mode). On activation: remember what had focus, move focus
// into the container (its first focusable element, or the container itself),
// and trap Tab/Shift+Tab inside it. On deactivation/unmount: restore focus to
// whatever had it before, if that element is still in the document.
//
// `onClose` is optional — pass it only when nothing inside the dialog already
// handles Escape, otherwise the dialog would close twice.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function isVisible(element: HTMLElement) {
  return element.offsetParent !== null || element === document.activeElement;
}

export function useDialogFocus(
  containerRef: React.RefObject<HTMLElement | null>,
  options: { onClose?: () => void; active?: boolean; trapFocus?: boolean; restoreTo?: React.RefObject<HTMLElement | null> } = {},
) {
  // `trapFocus: false` keeps initial focus, Escape, and restore-on-close but
  // lets Tab leave the container, for panels that still need the map behind
  // them. `restoreTo` overrides the auto-captured opener when activation
  // happens later than the open (e.g. after an intro overlay).
  const { onClose, active = true, trapFocus = true, restoreTo } = options;
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Callers usually pass an inline onClose, so its identity changes on every
  // parent render. Keep the latest one in a ref so the activation effect runs
  // only on open/close; re-running it would move focus back to the first
  // control mid-interaction.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Keep the earlier opener if focus is already inside the dialog. In dev,
    // StrictMode re-runs this effect right after the first pass focused the
    // Close button, and the page behind is `inert`, so the cleanup in between
    // can't hand focus back to the opener.
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!(focused && container.contains(focused))) previouslyFocused.current = focused;
    // Read once at activation; the opener ref is filled before this effect runs.
    const restoreTarget = restoreTo?.current ?? null;

    // Re-read the ref on each call: a dialog may swap its root element while
    // open (AuthPanel's email and code steps), and this effect won't re-run.
    const getFocusable = () => Array.from((containerRef.current ?? container).querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);

    const initial = getFocusable()[0];
    if (initial) {
      initial.focus();
    } else if (document.activeElement !== container) {
      container.setAttribute("tabindex", "-1");
      container.focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      const close = onCloseRef.current;
      if (event.key === "Escape" && close) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !trapFocus) return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const toRestore = restoreTarget ?? previouslyFocused.current;
      if (toRestore && document.contains(toRestore)) toRestore.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- containerRef is a ref; onClose is read through onCloseRef.
  }, [active, trapFocus, restoreTo]);
}
