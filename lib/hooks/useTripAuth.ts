"use client";

import { useCallback, useEffect, useState } from "react";
import type { BackendClient, BackendUser } from "@/lib/backend";

type AuthTone = "info" | "error";

export function useTripAuth(backend: BackendClient | null) {
  const [user, setUser] = useState<BackendUser | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(backend));
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authMessageTone, setAuthMessageTone] = useState<AuthTone>("info");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);

  useEffect(() => {
    if (!backend) return;
    let mounted = true;
    void backend.auth.getSession()
      .then(({ data: sessionData }) => {
        if (!mounted) return;
        setUser(sessionData.session?.user ?? null);
      })
      .catch((sessionError: unknown) => {
        if (!mounted) return;
        setAuthMessageTone("error");
        setAuthMessage(sessionError instanceof Error ? sessionError.message : "Could not restore your session.");
      })
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });
    const { data: listener } = backend.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setAuthMessage(null);
      setAuthMessageTone("info");
      if (session?.user) setAuthPanelOpen(false);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [backend]);

  const signIn = useCallback(async (email: string) => {
    if (!backend) return;
    setAuthSubmitting(true);
    setAuthMessage(null);
    setAuthMessageTone("info");
    try {
      const { error: signInError } = await backend.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      setAuthMessageTone(signInError ? "error" : "info");
      setAuthMessage(signInError ? signInError.message : "Check your email for a sign-in link.");
    } catch (signInError) {
      setAuthMessageTone("error");
      setAuthMessage(signInError instanceof Error ? signInError.message : "Could not start email sign-in.");
    } finally {
      setAuthSubmitting(false);
    }
  }, [backend]);

  const signInWithGoogle = useCallback(async () => {
    if (!backend) return;
    setAuthSubmitting(true);
    setAuthMessage(null);
    setAuthMessageTone("info");
    try {
      const { error: signInError } = await backend.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (!signInError) return;
      setAuthMessageTone("error");
      setAuthMessage(signInError.message);
    } catch (signInError) {
      setAuthMessageTone("error");
      setAuthMessage(signInError instanceof Error ? signInError.message : "Could not start Google sign-in.");
    } finally {
      setAuthSubmitting(false);
    }
  }, [backend]);

  const signOut = useCallback(async () => {
    if (!backend) return;
    try {
      await backend.auth.signOut();
      setUser(null);
    } catch (signOutError) {
      setAuthMessageTone("error");
      setAuthMessage(signOutError instanceof Error ? signOutError.message : "Could not sign out.");
    }
  }, [backend]);

  return {
    user,
    authLoading,
    authMessage,
    authMessageTone,
    authSubmitting,
    authPanelOpen,
    setAuthPanelOpen,
    signIn,
    signInWithGoogle,
    signOut,
  };
}
