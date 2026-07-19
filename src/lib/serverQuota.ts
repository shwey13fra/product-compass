// Stage 16 — server-side quota identity + plan resolution. SERVER-ONLY (reads
// process.env, verifies auth tokens). Shared by /api/position and /api/quota so
// the plan→limit rule lives in exactly one place.
//
// SECURITY (critical): the PLAN is derived ONLY from a VERIFIED bearer token →
// that user's profiles.plan. It is NEVER read from compass_uid / x-compass-uid,
// which are client-controlled — trusting them would let anyone spoof a Pro user's
// UUID to get unlimited briefs. Anonymous callers are always 'free'.

import { createClient } from "@supabase/supabase-js";

export type Plan = "free" | "pro";

// Free monthly live-brief cap (Pro is unlimited, IP-hourly-capped only).
export const FREE_BRIEFS_PER_MONTH = Number(process.env.FREE_BRIEFS_PER_MONTH ?? 3);

// Per-plan monthly limit passed to increment_ai_usage. -1 = unlimited (Pro).
export function planLimit(plan: Plan): number {
  return plan === "pro" ? -1 : FREE_BRIEFS_PER_MONTH;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return (req.headers.get("x-real-ip") ?? "").trim();
}

// Resolve the metering identity AND the plan in one token verification.
//   identity = verified auth user id (signed in) → else compass_uid → else ip:*
//   plan     = 'pro' ONLY when a verified token maps to profiles.plan='pro'
export async function resolveIdentityAndPlan(
  req: Request,
  ip: string
): Promise<{ identity: string; plan: Plan }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization");

  if (auth && /^bearer /i.test(auth) && url && anon) {
    try {
      const token = auth.slice(7).trim();
      const scoped = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: userData } = await scoped.auth.getUser();
      const uid = userData.user?.id;
      if (uid) {
        // Own-row read is allowed by the profiles RLS select policy. Any failure
        // (missing row, RLS, network) falls back to 'free' — never grants Pro.
        let plan: Plan = "free";
        try {
          const { data: prof } = await scoped
            .from("profiles")
            .select("plan")
            .eq("id", uid)
            .maybeSingle();
          if (prof?.plan === "pro") plan = "pro";
        } catch {
          // stays free
        }
        return { identity: uid, plan };
      }
    } catch {
      // fall through to the anonymous identity (always free)
    }
  }

  const uid = req.headers.get("x-compass-uid")?.trim();
  return { identity: uid || (ip ? `ip:${ip}` : ""), plan: "free" };
}
