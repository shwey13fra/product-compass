// Stage 10 — first-party, zero-cost product analytics.
// Writes one row per event to the Supabase `events` table (INSERT-only RLS, see
// scripts/stage10-analytics.sql). Client-side only — attaches the anonymous
// compass_uid and, if signed in, the auth user id.
//
// HARD RULES:
//   * Fire-and-forget: track() returns void and NEVER blocks the UI. Callers
//     don't await it.
//   * Never throws: any failure (offline, missing table, RLS) is swallowed —
//     instrumentation must never break a user flow.
//   * NO PII: props may contain ONLY ids, enums, booleans, counts. Never emails,
//     names, JD text, experience, or brief/message contents.

import { supabase } from "@/lib/supabase";
import { getCompassUid } from "@/lib/compass-uid";

// The closed set of events we track — a union type keeps instrumentation honest
// and typo-proof (and stops "just one more" event noise from creeping in).
export type EventName =
  | "role_viewed"
  | "fit_read_shown"
  | "brief_generated" // { mode: "live" | "manual", role_id }
  | "brief_copied" // { role_id }
  | "brief_rated" // { role_id, mode, rating } — NEVER the note text (PII)
  | "brief_used_reported" // { role_id, used }
  | "applied" // { role_id, had_brief: boolean }
  | "status_changed" // { from, to }
  | "nudge_shown" // { role_id }
  | "referral_thread_message" // { role_id }
  | "onboarding_completed"
  | "sign_in"
  | "quota_exhausted" // { plan } — free user hit the monthly brief cap (upgrade panel shown)
  | "upgrade_intent" // { plan } — clicked "I'm interested" on the Pro upgrade panel (WTP signal)
  | "notification_sent" // { kind: "status" | "comment", sent } — server-side, no PII
  | "ingest_run"; // { trigger, added, updated, expired, sources_ok, sources_failed }

export function track(
  name: EventName,
  props: Record<string, unknown> = {}
): void {
  // No-op during SSR (no localStorage, no user context).
  if (typeof window === "undefined") return;

  // Run the async insert without making the caller wait on it.
  void (async () => {
    try {
      const uid = getCompassUid();
      let userId: string | null = null;
      try {
        const { data } = await supabase.auth.getSession();
        userId = data.session?.user?.id ?? null;
      } catch {
        // No session / auth unavailable → stays anonymous. Fine.
      }
      await supabase.from("events").insert({ uid, user_id: userId, name, props });
    } catch {
      // Fire-and-forget: swallow everything. Analytics must never surface an error.
    }
  })();
}

// Server-side sibling of track(). track() no-ops when `window` is undefined, so
// calling it from a route handler or a cron would silently record NOTHING —
// instrumentation that never fires, behind a dashboard you'd trust. Mirrors
// logError: direct insert, never throws, no browser context (uid/user_id null).
// PII rule unchanged: counts/enums/booleans only — never company names or JD text.
export async function trackServer(
  name: EventName,
  props: Record<string, unknown> = {}
): Promise<void> {
  try {
    await supabase.from("events").insert({ uid: null, user_id: null, name, props });
  } catch {
    // Instrumentation must never break the request it reports on.
  }
}
