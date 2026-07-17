// Stage 13 — data access for brief feedback (did the positioning actually help?).
//
// The uid (compass_uid) is a SECRET the client holds, not a verified claim, so
// `brief_feedback` is RLS deny-all and every call here goes through a SECURITY
// DEFINER RPC that requires the uid (scripts/stage13-brief-feedback.sql).
// A uid POLICY would be worthless: the anon key is public, so anyone could claim
// someone else's uid. Same pattern as `applications` (stage 11).
//
// NO AI in this file. Anon key only, no secrets.

import { supabase } from "@/lib/supabase";
import type { Result } from "@/lib/referrals";

export const NOTE_MAX = 280;

export type BriefMode = "live" | "manual" | "unknown";
export type BriefRating = "thumbs_up" | "thumbs_down";

export type BriefFeedbackRow = {
  id: string;
  uid: string;
  role_id: string;
  brief_mode: BriefMode;
  rating: BriefRating | null;
  used_in_application: boolean | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

// Briefs saved before Stage 13 carry no mode. Report that honestly rather than
// guessing "live" — a wrong mode would silently corrupt the live-vs-manual
// comparison that is the entire point of /admin/quality.
export function resolveBriefMode(mode: "live" | "manual" | undefined): BriefMode {
  return mode ?? "unknown";
}

export function validateNote(
  note: string | null
): { ok: true; note: string | null } | { ok: false; error: string } {
  if (note === null) return { ok: true, note: null };
  const t = note.trim();
  if (t.length === 0) return { ok: true, note: null };
  if (t.length > NOTE_MAX) return { ok: false, error: `Keep it under ${NOTE_MAX} characters.` };
  return { ok: true, note: t };
}

export async function rateBrief(
  uid: string,
  roleId: string,
  mode: BriefMode,
  rating: BriefRating,
  note: string | null
): Promise<Result<BriefFeedbackRow>> {
  const v = validateNote(note);
  if (!v.ok) return { ok: false, error: v.error };
  const { data, error } = await supabase.rpc("rate_brief", {
    p_uid: uid,
    p_role: roleId,
    p_mode: mode,
    p_rating: rating,
    p_note: v.note,
  });
  if (error) return { ok: false, error: "Couldn't save that." };
  return { ok: true, data: data as BriefFeedbackRow };
}

export async function reportBriefUsed(
  uid: string,
  roleId: string,
  mode: BriefMode,
  used: boolean
): Promise<Result<BriefFeedbackRow>> {
  const { data, error } = await supabase.rpc("report_brief_used", {
    p_uid: uid,
    p_role: roleId,
    p_mode: mode,
    p_used: used,
  });
  if (error) return { ok: false, error: "Couldn't save that." };
  return { ok: true, data: data as BriefFeedbackRow };
}

export async function getBriefFeedback(
  uid: string,
  roleId: string
): Promise<Result<BriefFeedbackRow | null>> {
  const { data, error } = await supabase.rpc("get_brief_feedback", {
    p_uid: uid,
    p_role: roleId,
  });
  if (error) return { ok: false, error: "Couldn't load feedback." };
  const rows = (data ?? []) as BriefFeedbackRow[];
  return { ok: true, data: rows[0] ?? null };
}
