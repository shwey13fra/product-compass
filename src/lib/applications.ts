// Stage 5/11 — application status tracking, keyed by compass_uid (owner_key).
// Stage 11: the `applications` table is now RLS deny-all; ALL access goes through
// SECURITY DEFINER functions that REQUIRE the owner_key (see
// scripts/stage11-ai-quota-and-rls.sql). Real isolation — you can only touch rows
// whose secret uid you already hold; enumeration is impossible.

import { supabase } from "@/lib/supabase";
import type { Role } from "@/lib/types";

export type ApplicationStatus =
  | "applied"
  | "seen"
  | "shared_with_hm"
  | "shortlisted"
  | "closed";

export type Application = {
  id: string;
  owner_key: string;
  role_id: string;
  status: ApplicationStatus;
  status_changed_at: string; // ISO
  created_at: string;
  updated_at: string;
};

// Ordered status strip. "closed" is terminal (suggest similar roles instead).
export const STATUS_STEPS: { key: ApplicationStatus; label: string }[] = [
  { key: "applied", label: "Applied" },
  { key: "seen", label: "Seen" },
  { key: "shared_with_hm", label: "Shared with HM" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "closed", label: "Closed" },
];

export function statusLabel(s: ApplicationStatus): string {
  return STATUS_STEPS.find((x) => x.key === s)?.label ?? s;
}

export function statusIndex(s: ApplicationStatus): number {
  return STATUS_STEPS.findIndex((x) => x.key === s);
}

// The next status in the strip, or null if already at the end.
export function nextStatus(s: ApplicationStatus): ApplicationStatus | null {
  const i = statusIndex(s);
  return i >= 0 && i < STATUS_STEPS.length - 1 ? STATUS_STEPS[i + 1].key : null;
}

export type ApplicationsResult =
  | { ok: true; applications: Application[] }
  | { ok: false; error: string };

export async function getApplicationsForOwner(
  ownerKey: string
): Promise<ApplicationsResult> {
  // RLS deny-all → read via the SECURITY DEFINER function, which returns only
  // rows for the exact owner_key we supply.
  const { data, error } = await supabase.rpc("get_applications", {
    p_uid: ownerKey,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, applications: (data ?? []) as Application[] };
}

export type ApplicationResult =
  | { ok: true; application: Application | null }
  | { ok: false; error: string };

export async function getApplication(
  ownerKey: string,
  roleId: string
): Promise<ApplicationResult> {
  const { data, error } = await supabase.rpc("get_application", {
    p_uid: ownerKey,
    p_role: roleId,
  });

  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Application[];
  return { ok: true, application: rows[0] ?? null };
}

// Upsert the status for (owner_key, role_id). The function re-stamps
// status_changed_at + updated_at so the follow-up nudge measures time since the
// last change.
export async function setStatus(
  ownerKey: string,
  roleId: string,
  status: ApplicationStatus
): Promise<ApplicationResult> {
  const { data, error } = await supabase.rpc("upsert_application", {
    p_uid: ownerKey,
    p_role: roleId,
    p_status: status,
  });

  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Application[];
  if (!rows[0]) return { ok: false, error: "Save returned no row." };
  return { ok: true, application: rows[0] };
}

// Demo affordance: shift status_changed_at back by `days` (keeps status) so the
// time-based "Seen" nudge can be seen without waiting real days or editing SQL.
// The function shifts the STORED status_changed_at server-side; updated_at is
// left alone so list order is stable.
export async function backdateStatusChange(
  ownerKey: string,
  roleId: string,
  days: number
): Promise<ApplicationResult> {
  const { data, error } = await supabase.rpc("backdate_application", {
    p_uid: ownerKey,
    p_role: roleId,
    p_days: days,
  });

  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Application[];
  if (!rows[0]) return { ok: false, error: "No application to backdate." };
  return { ok: true, application: rows[0] };
}

// --- Follow-up nudge (pure JS) ----------------------------------------------
// "If a role sits at Seen with no movement for a while → light follow-up."
// Threshold = the role's crowd_response_days (fallback 5) — consistent with the
// "time vs crowd stat" decision.

const DEFAULT_FOLLOWUP_DAYS = 5;

export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso).getTime();
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

export type FollowUpNudge = { days: number; threshold: number; message: string };

export function computeFollowUpNudge(
  app: Application,
  role: Role,
  now: Date = new Date()
): FollowUpNudge | null {
  if (app.status !== "seen") return null;
  const threshold = role.crowd_response_days ?? DEFAULT_FOLLOWUP_DAYS;
  const days = daysSince(app.status_changed_at, now);
  if (days < threshold) return null;
  return {
    days,
    threshold,
    message: "Good time for a light follow-up.",
  };
}
