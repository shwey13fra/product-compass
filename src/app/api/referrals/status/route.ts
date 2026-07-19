// Stage 15 — referral status change (server-side, so we can send email on it).
// The write runs with the CALLER's forwarded token → Postgres RLS decides whether
// they may update this row (exactly as the old client write did; never
// service-role). On success we fire a fire-and-forget notify to the OTHER party.

import { NextResponse } from "next/server";
import {
  bearer,
  scopedClientFromToken,
  notifyReferral,
} from "@/lib/referralNotify";
import { statusLabel, type ApplicationStatus } from "@/lib/applications";
import { logError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_COLUMNS =
  "id,role_id,referee_id,referrer_email,status,status_changed_at,comment_count,last_comment_at,created_at,updated_at";
const VALID: ApplicationStatus[] = [
  "applied",
  "seen",
  "shared_with_hm",
  "shortlisted",
  "closed",
];

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token)
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let body: { applicationId?: string; status?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const appId = String(body.applicationId ?? "");
  const status = String(body.status ?? "") as ApplicationStatus;
  if (!appId || !VALID.includes(status))
    return NextResponse.json(
      { ok: false, error: "Missing application or valid status." },
      { status: 400 }
    );

  const scoped = scopedClientFromToken(token);
  if (!scoped)
    return NextResponse.json({ ok: false, error: "Server misconfigured." }, { status: 500 });

  const now = new Date().toISOString();
  const { data, error } = await scoped
    .from("referral_applications")
    .update({ status, status_changed_at: now, updated_at: now })
    .eq("id", appId)
    .select(APP_COLUMNS)
    .single();

  if (error || !data) {
    await logError("api/referrals/status", "update failed", { hasData: !!data });
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Could not update status." },
      { status: 400 }
    );
  }

  // Email is fire-and-forget: it can never change the outcome the user sees.
  await notifyReferral(scoped, req, {
    appId,
    kind: "status",
    toLabel: statusLabel(status),
  });

  return NextResponse.json({ ok: true, data });
}
