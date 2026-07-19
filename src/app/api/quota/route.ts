// Stage 16 — read-only quota peek for the pre-click indicator. SERVER-ONLY.
// Returns the caller's plan + current-month usage WITHOUT spending a call (never
// increments), so it can't be abused to drain the budget. Identity + plan come
// from @/lib/serverQuota (plan is verified-token only — compass_uid can't grant Pro).

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  clientIp,
  resolveIdentityAndPlan,
  FREE_BRIEFS_PER_MONTH,
} from "@/lib/serverQuota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ip = clientIp(req);
  const { identity, plan } = await resolveIdentityAndPlan(req, ip);

  // limit: null = unlimited (Pro). Free = FREE_BRIEFS_PER_MONTH.
  const limit = plan === "pro" ? null : FREE_BRIEFS_PER_MONTH;

  let used = 0;
  try {
    const { data } = await supabase.rpc("get_ai_usage", { p_identity: identity });
    const row = Array.isArray(data) ? data[0] : data;
    used = row?.used ?? 0;
  } catch {
    // On failure, report 0 used — the real cap is still enforced at generate time.
  }

  const remaining = limit === null ? null : Math.max(0, limit - used);
  return NextResponse.json({ plan, limit, used, remaining });
}
