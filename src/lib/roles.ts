import { supabase } from "@/lib/supabase";
import type { Role } from "@/lib/types";

// Data access for the shared, seeded `roles` table. Used from Server
// Components — the anon client reads NEXT_PUBLIC_* env which is available
// server-side too. No owner_key here: roles are shared across all users.

const ROLE_COLUMNS =
  "id,company,title,archetype,real_pm_score,real_pm_signals,is_live,freshness_checked_at,location,jd_text,crowd_response_days,has_warm_path,warm_path_note,is_referral,referrer_email,source,external_id,apply_url,ingested_at";

export type RolesResult =
  | { ok: true; roles: Role[] }
  | { ok: false; error: string };

export async function getRoles(): Promise<RolesResult> {
  const { data, error } = await supabase
    .from("roles")
    .select(ROLE_COLUMNS)
    // Highest real-PM score first so the genuine roles lead.
    .order("real_pm_score", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, roles: (data ?? []) as Role[] };
}

// Fetch a specific set of roles by id (for the Tracking page, which knows the
// applied role_ids up front). Returns whatever it finds; missing ids are dropped.
export async function getRolesByIds(ids: string[]): Promise<RolesResult> {
  if (ids.length === 0) return { ok: true, roles: [] };
  const { data, error } = await supabase
    .from("roles")
    .select(ROLE_COLUMNS)
    .in("id", ids);

  if (error) return { ok: false, error: error.message };
  return { ok: true, roles: (data ?? []) as Role[] };
}

export type RoleResult =
  | { ok: true; role: Role }
  | { ok: false; error: string; notFound?: boolean };

export async function getRoleById(id: string): Promise<RoleResult> {
  const { data, error } = await supabase
    .from("roles")
    .select(ROLE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    // A malformed id (not a valid uuid) can never match a role — Postgres raises
    // 22P02 (invalid_text_representation). Treat it as "not found" so the clean
    // not-found page renders instead of leaking the raw DB error to the UI.
    if (error.code === "22P02" || /invalid input syntax for type uuid/i.test(error.message))
      return { ok: false, error: "Role not found", notFound: true };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "Role not found", notFound: true };
  return { ok: true, role: data as Role };
}

// Stage 17.5 — sample-retirement support. Counts drive the admin panel and gate
// the archive action (enabled only when live ingested roles >= threshold).
export async function getSampleCounts(): Promise<{
  sampleTotal: number;
  sampleLive: number;
  liveIngested: number;
}> {
  const { data } = await supabase.from("roles").select("source,is_live");
  let sampleTotal = 0;
  let sampleLive = 0;
  let liveIngested = 0;
  (data ?? []).forEach((r: { source: string | null; is_live: boolean }) => {
    if (r.source === "seed") {
      sampleTotal++;
      if (r.is_live) sampleLive++;
    } else if (r.source && r.is_live) {
      liveIngested++;
    }
  });
  return { sampleTotal, sampleLive, liveIngested };
}

// Reversible archive/restore of the illustrative sample (source='seed') roles.
// Admin-only via RLS (roles UPDATE requires is_admin()). NOTE: restore sets ALL
// seed roles live, including any that were closed for other reasons — acceptable
// for this demo affordance. Returns how many rows were updated.
export async function setSampleRolesLive(
  isLive: boolean
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("roles")
    .update({ is_live: isLive })
    .eq("source", "seed")
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: data?.length ?? 0 };
}

// Stage 5 — "On Closed, suggest 3–4 similar live roles": same archetype, still
// live, excluding the closed one, best real-PM score first. Works client-side
// too (anon client). Failures degrade to an empty list — never blocks the card.
export async function getSimilarLiveRoles(
  role: Pick<Role, "id" | "archetype">,
  limit = 4
): Promise<Role[]> {
  const { data, error } = await supabase
    .from("roles")
    .select(ROLE_COLUMNS)
    .eq("archetype", role.archetype)
    .eq("is_live", true)
    .neq("id", role.id)
    .order("real_pm_score", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as Role[];
}
