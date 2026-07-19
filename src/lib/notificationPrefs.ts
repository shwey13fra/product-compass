// Stage 15 — client helper for the per-user email-notification toggle. Keyed by
// EMAIL; RLS lets a signed-in user read/write only their own row
// (scripts/stage15-notifications.sql). Default ON: a missing row = enabled.

import { supabase } from "@/lib/supabase";

export async function getMyEmailPref(email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("notification_prefs")
    .select("emails_enabled")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error || !data) return true; // missing row / error → default on
  return data.emails_enabled as boolean;
}

export async function setMyEmailPref(
  email: string,
  enabled: boolean
): Promise<boolean> {
  const { error } = await supabase.from("notification_prefs").upsert(
    {
      email: email.trim().toLowerCase(),
      emails_enabled: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" }
  );
  return !error;
}
