"use client";

// Stage 7 — client-side auth helpers (Supabase magic link / passwordless email).
// No secrets here: uses the anon browser client. The anonymous user side never
// touches this; only the admin + referral surfaces require a session.

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isAdminEmail } from "@/config";

export type SignInResult = { ok: true } | { ok: false; error: string };

// Send a one-tap magic link. After the user clicks it they land on
// /auth/callback (which finishes the session and forwards to `next`).
export async function signInWithEmail(
  email: string,
  next?: string
): Promise<SignInResult> {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const redirect = next
    ? `${origin}/auth/callback?next=${encodeURIComponent(next)}`
    : `${origin}/auth/callback`;

  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: { emailRedirectTo: redirect },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Subscribes to the session. Returns { user, loading }. `user` is null when
// signed out. Re-renders on sign-in / sign-out across tabs.
export function useUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

// True when the signed-in user's email is in ADMIN_EMAILS (UI gate only — RLS
// is the real enforcement). Safe to call with a loading/None user.
export function useIsAdmin(): boolean {
  const { user } = useUser();
  return isAdminEmail(user?.email);
}

export { isAdminEmail };
