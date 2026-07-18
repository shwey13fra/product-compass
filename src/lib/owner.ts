// Stage 14 — owner_key resolution for stored user DATA (applications,
// brief_feedback, experience_profiles).
//
// The owner of a user's data is their VERIFIED auth id when signed in, else the
// anonymous compass_uid. Anonymous users have no session → always compass_uid →
// their flow is byte-for-byte unchanged (regression requirement). After a
// signed-in user's data is re-keyed by claim_anonymous_data(), reads must use
// the auth id — that's what this returns.
//
// NOTE: this is for data OWNERSHIP only. Device analytics (lib/analytics.ts) and
// the AI-quota header (PositioningPanel) intentionally keep using the raw
// compass_uid — they identify the device / meter per identity, not who owns a row.

import { supabase } from "@/lib/supabase";
import { getCompassUid } from "@/lib/compass-uid";

export async function resolveOwnerKey(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const authId = data.session?.user?.id;
    if (authId) return authId;
  } catch {
    // No session / auth unavailable → fall back to the anonymous device id.
  }
  return getCompassUid();
}
