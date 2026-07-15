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
