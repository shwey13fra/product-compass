"use client";

// Stage 14 — one client boot component mounted once in the root layout. It owns:
//   1. Experience durability: reconcile localStorage ⇄ Supabase on load and on
//      every auth transition (newest-wins), for both anon and signed-in owners.
//   2. First sign-in claim: re-key this device's anonymous data onto the auth id
//      exactly once (guarded by a per-auth-id localStorage flag), then show a
//      one-time toast if anything was actually linked.
//
// A single auth listener (rather than one per feature) keeps this cheap and
// avoids duplicate claim calls. Everything here is best-effort and swallows
// errors — instrumentation/sync must never break a user flow.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { getCompassUid } from "@/lib/compass-uid";
import { reconcileExperience } from "@/lib/experienceSync";
import { claimAnonymousData, claimTotal } from "@/lib/claim";
import { Toast } from "@/components/Toast";

const CLAIM_MESSAGE = "Your saved work has been linked to your account.";

export function AppBoot() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function handle(session: Session | null) {
      const authId = session?.user?.id ?? null;

      if (authId) {
        // First sign-in on this device for this account → claim once.
        const flagKey = `compass_claimed:${authId}`;
        let alreadyClaimed = true;
        try {
          alreadyClaimed = !!window.localStorage.getItem(flagKey);
        } catch {
          // localStorage unavailable → treat as claimed (skip); harmless.
        }
        if (!alreadyClaimed) {
          const summary = await claimAnonymousData();
          // Set the flag even when nothing moved, so we never re-run the RPC or
          // re-toast on this device (the RPC is idempotent, but this avoids the
          // extra round-trip and any chance of a repeat toast).
          try {
            window.localStorage.setItem(flagKey, "1");
          } catch {}
          if (active && claimTotal(summary) > 0) setMessage(CLAIM_MESSAGE);
        }
        await reconcileExperience(authId);
      } else {
        await reconcileExperience(getCompassUid());
      }
    }

    // Initial state (fires once with the current session).
    supabase.auth.getSession().then(({ data }) => {
      if (active) void handle(data.session);
    });

    // Only react to real transitions; the initial load is covered above.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") void handle(session);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!message) return null;
  return <Toast message={message} onClose={() => setMessage(null)} />;
}
