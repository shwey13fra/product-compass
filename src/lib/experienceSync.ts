// Stage 14 — background sync of the experience profile to Supabase.
//
// localStorage stays the INSTANT source of truth (loadExperience/saveExperience
// are unchanged and never block on the network). This module adds a durable
// server copy, keyed by owner_key, with three properties:
//   * debounced background push after a user edit (scheduleExperiencePush)
//   * on-load reconcile with NEWEST-WINS between local and remote
//   * every Supabase failure is swallowed — if sync is down, the app is exactly
//     the localStorage-only app it was before (regression-safe).

import { supabase } from "@/lib/supabase";
import {
  loadExperience,
  writeExperienceRaw,
  type ExperienceProfile,
} from "@/lib/experience";

type Row = { owner_key: string; payload: ExperienceProfile; updated_at: string };

// Read the server copy for this owner_key (or null on miss/error).
export async function getRemoteExperience(
  ownerKey: string
): Promise<ExperienceProfile | null> {
  try {
    const { data, error } = await supabase.rpc("get_experience", {
      p_owner: ownerKey,
    });
    if (error) return null;
    const rows = (data ?? []) as Row[];
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

// Push the local copy to the server. Fire-and-forget: never throws, never
// blocks a user flow. The RPC guards against clobbering a newer server row.
export async function pushExperienceNow(
  ownerKey: string,
  profile: ExperienceProfile
): Promise<void> {
  try {
    await supabase.rpc("upsert_experience", {
      p_owner: ownerKey,
      p_payload: profile,
      p_updated_at: profile.updatedAt,
    });
  } catch {
    // Sync is best-effort; localStorage already holds the truth.
  }
}

// Debounced push — coalesces rapid saves into one network write.
let pushTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleExperiencePush(
  ownerKey: string | null,
  profile: ExperienceProfile,
  delay = 1500
): void {
  if (!ownerKey) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushExperienceNow(ownerKey, profile);
  }, delay);
}

// On load: pick the newer of {local, remote} by updatedAt and converge both to
// it. Returns the winner (or null if neither exists). Safe when offline.
export async function reconcileExperience(
  ownerKey: string | null
): Promise<ExperienceProfile | null> {
  if (!ownerKey) return loadExperience();

  const local = loadExperience();
  const remote = await getRemoteExperience(ownerKey);

  if (!remote) {
    // Nothing on the server yet — seed it from local if we have one.
    if (local) void pushExperienceNow(ownerKey, local);
    return local;
  }
  if (!local || remote.updatedAt > local.updatedAt) {
    // Server is newer (or we have nothing local): hydrate WITHOUT re-stamping.
    writeExperienceRaw(remote);
    return remote;
  }
  if (local.updatedAt > remote.updatedAt) {
    // Local is newer: push it up.
    void pushExperienceNow(ownerKey, local);
  }
  return local;
}
