// Stage 7 — data access for the AUTHED referral collaboration.
// Every call runs with the signed-in user's session; Postgres RLS (see
// scripts/stage7-auth-referrals.sql) is the real enforcement — these helpers
// must never assume more access than RLS grants. Anon key only, no secrets.

import { supabase } from "@/lib/supabase";
import type { ApplicationStatus } from "@/lib/applications";
import type { Archetype } from "@/lib/types";

export type ReferralApplication = {
  id: string;
  role_id: string;
  referee_id: string;
  referrer_email: string;
  status: ApplicationStatus;
  status_changed_at: string;
  comment_count: number;
  last_comment_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Comment = {
  id: string;
  application_id: string;
  author_id: string;
  author_email: string | null;
  body: string;
  created_at: string;
};

const APP_COLUMNS =
  "id,role_id,referee_id,referrer_email,status,status_changed_at,comment_count,last_comment_at,created_at,updated_at";
const COMMENT_COLUMNS =
  "id,application_id,author_id,author_email,body,created_at";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// --- Referral applications ---------------------------------------------------

// Referee applies to a referral role. Idempotent: returns the existing row if
// they already applied (unique role_id+referee_id). RLS insert requires
// referee_id = auth.uid().
export async function createReferralApplication(
  roleId: string,
  refereeId: string,
  referrerEmail: string
): Promise<Result<ReferralApplication>> {
  const existing = await supabase
    .from("referral_applications")
    .select(APP_COLUMNS)
    .eq("role_id", roleId)
    .eq("referee_id", refereeId)
    .maybeSingle();
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data)
    return { ok: true, data: existing.data as ReferralApplication };

  const { data, error } = await supabase
    .from("referral_applications")
    .insert({
      role_id: roleId,
      referee_id: refereeId,
      referrer_email: referrerEmail.trim().toLowerCase(),
    })
    .select(APP_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as ReferralApplication };
}

// All referral applications visible to the current session (RLS scopes this to
// rows where I'm the referee, the tagged referrer, or an admin).
export async function getMyReferralApplications(): Promise<
  Result<ReferralApplication[]>
> {
  const { data, error } = await supabase
    .from("referral_applications")
    .select(APP_COLUMNS)
    .order("updated_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as ReferralApplication[] };
}

// Find this user's application to a specific role (or null). Used to decide
// whether the referral apply button shows "Apply" or "Open thread".
export async function findReferralApplication(
  roleId: string,
  refereeId: string
): Promise<Result<ReferralApplication | null>> {
  const { data, error } = await supabase
    .from("referral_applications")
    .select(APP_COLUMNS)
    .eq("role_id", roleId)
    .eq("referee_id", refereeId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as ReferralApplication) ?? null };
}

export async function getReferralApplication(
  id: string
): Promise<Result<ReferralApplication | null>> {
  const { data, error } = await supabase
    .from("referral_applications")
    .select(APP_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as ReferralApplication) ?? null };
}

// Update status (referee, referrer, or admin per RLS). Stage 15: goes through the
// server route so an email can be sent to the other party; the route performs the
// write with THIS user's forwarded token, so RLS enforcement is unchanged.
export async function setReferralStatus(
  id: string,
  status: ApplicationStatus
): Promise<Result<ReferralApplication>> {
  return postReferralWrite<ReferralApplication>("/api/referrals/status", {
    applicationId: id,
    status,
  });
}

// Shared: attach the session token and POST a referral write-route. Returns the
// same Result shape the callers already handle.
async function postReferralWrite<T>(
  url: string,
  payload: Record<string, unknown>
): Promise<Result<T>> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { ok: false, error: "Please sign in again." };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
    if (!res.ok || !json.ok || json.data === undefined)
      return { ok: false, error: json.error ?? "Request failed." };
    return { ok: true, data: json.data };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

// --- Comments (referee + referrer ONLY; admins are blocked by RLS) -----------

export async function getComments(
  applicationId: string
): Promise<Result<Comment[]>> {
  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_COLUMNS)
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as Comment[] };
}

// Stage 15: posts through the server route (which derives the author from the
// verified token and emails the other party). authorId/authorEmail are no longer
// sent by the client — the server is authoritative — but the signature is kept so
// existing call sites don't change.
export async function addComment(
  applicationId: string,
  _authorId: string,
  _authorEmail: string | null,
  body: string
): Promise<Result<Comment>> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Comment can’t be empty." };
  return postReferralWrite<Comment>("/api/referrals/comment", {
    applicationId,
    body: trimmed,
  });
}

// The viewer's relationship to an application, for labelling in the UI.
export function viewerRole(
  app: ReferralApplication,
  userId: string,
  email: string | null | undefined,
  admin: boolean
): "referee" | "referrer" | "admin" | "none" {
  if (app.referee_id === userId) return "referee";
  if (email && app.referrer_email.toLowerCase() === email.toLowerCase())
    return "referrer";
  if (admin) return "admin";
  return "none";
}

// Which statuses a given viewer may set. Referrer drives the pipeline (they have
// the hiring-side visibility); referee can only withdraw (Closed); admin can only
// close a dormant thread (see isDormant). This mirrors the server-side state
// machine in set_referral_status() (scripts/stage19-referral-status-rules.sql) —
// the RPC is the real enforcement; this only shapes the buttons.
export function allowedStatusesFor(
  role: "referee" | "referrer" | "admin" | "none"
): ApplicationStatus[] {
  switch (role) {
    case "referrer":
      return ["seen", "shared_with_hm", "shortlisted", "closed"];
    case "referee":
      return ["closed"];
    case "admin":
      return ["closed"];
    default:
      return [];
  }
}

// An admin may close a thread only after it has been dormant for 90+ days — no
// status change AND no message. Mirrors the guard in set_referral_status() so the
// UI never offers an action the server would reject. "Position filled" isn't
// tracked, so dormancy is the enforceable proxy for "it's been >3 months".
export function isDormant(app: ReferralApplication): boolean {
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const statusAt = new Date(app.status_changed_at).getTime();
  const commentAt = app.last_comment_at
    ? new Date(app.last_comment_at).getTime()
    : 0;
  const lastActivity = Math.max(statusAt, commentAt);
  return Date.now() - lastActivity >= NINETY_DAYS_MS;
}

export function statusBadgeRole(
  app: ReferralApplication,
  userId: string,
  email: string | null | undefined,
  admin: boolean
): string {
  switch (viewerRole(app, userId, email, admin)) {
    case "referee":
      return "You applied";
    case "referrer":
      return "You’re the referrer";
    case "admin":
      return "Admin view";
    default:
      return "Shared";
  }
}

// --- Unread / read tracking (in-app notification indicator) ------------------

// Mark the thread read up to "now" for this user.
export async function markRead(
  applicationId: string,
  userId: string
): Promise<void> {
  await supabase
    .from("application_reads")
    .upsert(
      { application_id: applicationId, user_id: userId, last_seen_at: new Date().toISOString() },
      { onConflict: "application_id,user_id" }
    );
}

// An application is unread if a comment or status change happened after the
// user's last_seen_at (baseline = created_at when never opened, so a freshly
// created application isn't flagged to its creator).
export function isUnread(
  app: ReferralApplication,
  lastSeenAt: string | null
): boolean {
  const baseline = new Date(lastSeenAt ?? app.created_at).getTime();
  const lastComment = app.last_comment_at
    ? new Date(app.last_comment_at).getTime()
    : 0;
  const statusAt = new Date(app.status_changed_at).getTime();
  return lastComment > baseline || statusAt > baseline;
}

// Returns the set of application ids that are unread for this user, plus whether
// there's any unread at all (for the nav dot). One round-trip for reads.
export async function getUnread(
  userId: string
): Promise<{ unreadIds: Set<string>; any: boolean }> {
  const apps = await getMyReferralApplications();
  if (!apps.ok || apps.data.length === 0)
    return { unreadIds: new Set(), any: false };

  const ids = apps.data.map((a) => a.id);
  const { data: reads } = await supabase
    .from("application_reads")
    .select("application_id,last_seen_at")
    .in("application_id", ids);

  const seen = new Map<string, string>();
  (reads ?? []).forEach((r: { application_id: string; last_seen_at: string }) =>
    seen.set(r.application_id, r.last_seen_at)
  );

  const unreadIds = new Set<string>();
  for (const app of apps.data) {
    if (isUnread(app, seen.get(app.id) ?? null)) unreadIds.add(app.id);
  }
  return { unreadIds, any: unreadIds.size > 0 };
}

// Resolve user ids → emails via profiles (admin can read all profiles per RLS;
// otherwise only your own row comes back). Used by the admin overview to label
// the referee. Returns a id→email map.
export async function getProfileEmails(
  ids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from("profiles")
    .select("id,email")
    .in("id", ids);
  (data ?? []).forEach((p: { id: string; email: string | null }) => {
    if (p.email) map.set(p.id, p.email);
  });
  return map;
}

// --- Admin: set a user's plan (Stage 16) -------------------------------------
// Calls the admin_set_plan RPC. Admin-only is enforced IN POSTGRES via is_admin()
// (the RPC raises if the caller isn't an admin). Returns the number of profiles
// updated: 0 means no signed-in user with that email (they must sign in once).
export async function setUserPlan(
  email: string,
  plan: "free" | "pro"
): Promise<Result<number>> {
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const { data, error } = await supabase.rpc("admin_set_plan", {
    p_email: trimmed,
    p_plan: plan,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as number) ?? 0 };
}

// --- Admin: create a referral role ------------------------------------------
// Admin-only by RLS (roles insert requires is_admin()). is_referral forced true.

export type NewReferralRole = {
  company: string;
  title: string;
  archetype: Archetype;
  real_pm_score: number;
  location: string | null;
  jd_text: string | null;
  referrer_email: string;
};

export async function adminCreateReferralRole(
  role: NewReferralRole
): Promise<Result<string>> {
  const { data, error } = await supabase
    .from("roles")
    .insert({
      company: role.company.trim(),
      title: role.title.trim(),
      archetype: role.archetype,
      real_pm_score: role.real_pm_score,
      location: role.location?.trim() || null,
      jd_text: role.jd_text?.trim() || null,
      referrer_email: role.referrer_email.trim().toLowerCase(),
      is_referral: true,
      // Explicit, not defaulted: `source` has no DB default, so omitting it wrote
      // NULL — and Stage 8's `update roles set source='seed' where source is null`
      // then swept referral roles into the seed bucket, where the documented
      // cleanup (`delete from roles where source='seed'`) would have deleted them.
      source: "referral",
      is_live: true,
      has_warm_path: true,
      freshness_checked_at: new Date().toISOString(),
      // These are NOT NULL in the roles table (the seed always sets them); the
      // admin form doesn't collect them, so supply sensible defaults.
      real_pm_signals: [] as string[],
      crowd_response_days: 7,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data as { id: string }).id };
}
