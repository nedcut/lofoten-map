"use client";

import { useCallback, useEffect, useState } from "react";
import type { BackendClient, BackendUser } from "@/lib/backend";

type AuthTone = "info" | "error";

// `backendConfigured` keeps auth "loading" while the lazily-imported client is
// still on its way, so signed-out controls don't flash before the session check.
export function useTripAuth(backend: BackendClient | null, backendConfigured = Boolean(backend)) {
  const [user, setUser] = useState<BackendUser | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(backend) || backendConfigured);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authMessageTone, setAuthMessageTone] = useState<AuthTone>("info");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  // Email that has been sent a one-time code and is waiting for it to be entered.
  const [pendingOtpEmail, setPendingOtpEmail] = useState<string | null>(null);

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
      if (session?.user) {
        setAuthPanelOpen(false);
        setPendingOtpEmail(null);
      }
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
      // Neon Auth emails a 6-digit code (not a magic link); verifyCode finishes the sign-in.
      const { error: signInError } = await backend.auth.signInWithOtp({ email });
      if (signInError) {
        setAuthMessageTone("error");
        setAuthMessage(signInError.message);
        return;
      }
      setPendingOtpEmail(email);
      setAuthMessageTone("info");
      setAuthMessage(`We emailed a 6-digit code to ${email}. Enter it below to sign in.`);
    } catch (signInError) {
      setAuthMessageTone("error");
      setAuthMessage(signInError instanceof Error ? signInError.message : "Could not start email sign-in.");
    } finally {
      setAuthSubmitting(false);
    }
  }, [backend]);

  const verifyCode = useCallback(async (code: string) => {
    if (!backend || !pendingOtpEmail) return;
    setAuthSubmitting(true);
    setAuthMessage(null);
    setAuthMessageTone("info");
    try {
      const { data, error: verifyError } = await backend.auth.verifyOtp({ email: pendingOtpEmail, token: code.replace(/\s+/g, ""), type: "email" });
      if (verifyError || !data.session) {
        setAuthMessageTone("error");
        setAuthMessage(verifyError?.message ?? "That code did not work. Check it and try again.");
        return;
      }
      setUser(data.session.user);
      setPendingOtpEmail(null);
      setAuthPanelOpen(false);
    } catch (verifyError) {
      setAuthMessageTone("error");
      setAuthMessage(verifyError instanceof Error ? verifyError.message : "Could not verify the code.");
    } finally {
      setAuthSubmitting(false);
    }
  }, [backend, pendingOtpEmail]);

  const cancelCodeEntry = useCallback(() => {
    setPendingOtpEmail(null);
    setAuthMessage(null);
    setAuthMessageTone("info");
  }, []);

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
    pendingOtpEmail,
    signIn,
    verifyCode,
    cancelCodeEntry,
    signInWithGoogle,
    signOut,
  };
}
