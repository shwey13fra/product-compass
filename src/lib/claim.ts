// Stage 14 — one-time anonymous→auth data claim.
//
// On first sign-in we re-key this device's anonymous data (compass_uid) onto the
// verified auth id via the claim_anonymous_data() RPC (auth.uid() is read from
// the session JWT inside the function, so this must be called while signed in).
// Returns a per-table count of rows moved; { moved: 0 } / null on no-op or error.

import { supabase } from "@/lib/supabase";
import { getCompassUid } from "@/lib/compass-uid";

export type ClaimSummary = {
  applications: number;
  brief_feedback: number;
  events: number;
  ai_usage: number;
  experience: number;
};

// Total rows moved across all tables — used to decide whether to show the toast
// (no point announcing a link when there was nothing to link).
export function claimTotal(s: ClaimSummary | null): number {
  if (!s) return 0;
  return (
    s.applications + s.brief_feedback + s.events + s.ai_usage + s.experience
  );
}

export async function claimAnonymousData(): Promise<ClaimSummary | null> {
  const uid = getCompassUid();
  if (!uid) return null;
  try {
    const { data, error } = await supabase.rpc("claim_anonymous_data", {
      p_uid: uid,
    });
    if (error) return null;
    return (data as ClaimSummary) ?? null;
  } catch {
    return null;
  }
}
