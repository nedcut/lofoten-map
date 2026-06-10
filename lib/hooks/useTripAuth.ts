"use client";

import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

type AuthTone = "info" | "error";

export function useTripAuth(supabase: SupabaseClient | null) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authMessageTone, setAuthMessageTone] = useState<AuthTone>("info");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!mounted) return;
      setUser(sessionData.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
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
  }, [supabase]);

  const signIn = useCallback(async (email: string) => {
    if (!supabase) return;
    setAuthSubmitting(true);
    setAuthMessage(null);
    setAuthMessageTone("info");
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setAuthMessageTone(signInError ? "error" : "info");
    setAuthMessage(signInError ? signInError.message : "Check your email for a sign-in link.");
    setAuthSubmitting(false);
  }, [supabase]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    setAuthSubmitting(true);
    setAuthMessage(null);
    setAuthMessageTone("info");
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (signInError) {
      setAuthMessageTone("error");
      setAuthMessage(signInError.message);
      setAuthSubmitting(false);
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

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
