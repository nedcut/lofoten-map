"use client";

import { useCallback, useState } from "react";

export type StatusTone = "info" | "error";

export interface StatusMessage {
  /** The current message text, or null when nothing is showing. */
  message: string | null;
  /** Whether the message reads as informational or as an error. */
  tone: StatusTone;
  /** Whether an operation feeding this message is in flight. */
  isSaving: boolean;
  /** Show an informational message. */
  setInfo: (message: string) => void;
  /** Show an error message. */
  setError: (message: string) => void;
  /** Toggle the in-flight flag. */
  setSaving: (saving: boolean) => void;
  /** Clear the message and reset the tone to info (keeps isSaving as-is). */
  reset: () => void;
}

/**
 * Bundles the message / tone / saving triplet that several panels share, so a
 * caller no longer has to declare and juggle three correlated useState slices
 * (and risk setting the message without its matching tone). Each
 * useStatusMessage() call owns one independent status channel.
 */
export function useStatusMessage(): StatusMessage {
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<StatusTone>("info");
  const [isSaving, setSaving] = useState(false);

  const setInfo = useCallback((next: string) => {
    setTone("info");
    setMessage(next);
  }, []);

  const setError = useCallback((next: string) => {
    setTone("error");
    setMessage(next);
  }, []);

  const reset = useCallback(() => {
    setMessage(null);
    setTone("info");
  }, []);

  return { message, tone, isSaving, setInfo, setError, setSaving, reset };
}
