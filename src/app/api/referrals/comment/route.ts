// Stage 15 — post a referral comment (server-side, so we can email the other
// party). Author identity is taken from the FORWARDED TOKEN, not the request body
// — the client can't claim to be someone else. RLS still enforces that the author
// is a thread participant. On success, fire-and-forget notify with the body.

import { NextResponse } from "next/server";
import {
  bearer,
  scopedClientFromToken,
  notifyReferral,
} from "@/lib/referralNotify";
import { logError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMENT_COLUMNS =
  "id,application_id,author_id,author_email,body,created_at";
const BODY_MAX = 2000;

export async function POST(req: Request) {
  const token = bearer(req);
  if (!token)
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  let body: { applicationId?: string; body?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const appId = String(body.applicationId ?? "");
  const text = String(body.body ?? "").trim();
  if (!appId) return NextResponse.json({ ok: false, error: "Missing application." }, { status: 400 });
  if (!text) return NextResponse.json({ ok: false, error: "Comment can’t be empty." }, { status: 400 });
  if (text.length > BODY_MAX)
    return NextResponse.json({ ok: false, error: "Comment is too long." }, { status: 400 });

  const scoped = scopedClientFromToken(token);
  if (!scoped)
    return NextResponse.json({ ok: false, error: "Server misconfigured." }, { status: 500 });

  // Author from the verified token — never trust a client-supplied author id.
  const { data: u } = await scoped.auth.getUser();
  const authorId = u.user?.id;
  const authorEmail = u.user?.email ?? null;
  if (!authorId)
    return NextResponse.json({ ok: false, error: "Session expired. Sign in again." }, { status: 401 });

  const { data, error } = await scoped
    .from("comments")
    .insert({
      application_id: appId,
      author_id: authorId,
      author_email: authorEmail,
      body: text,
    })
    .select(COMMENT_COLUMNS)
    .single();

  if (error || !data) {
    await logError("api/referrals/comment", "insert failed", { hasData: !!data });
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Could not post comment." },
      { status: 400 }
    );
  }

  await notifyReferral(scoped, req, { appId, kind: "comment", body: text });

  return NextResponse.json({ ok: true, data });
}
