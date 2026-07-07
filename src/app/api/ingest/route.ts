// Stage 8 — admin-triggered job ingestion. POST only. Writes to the RLS-locked
// `roles` table by forwarding the signed-in admin's Supabase JWT (Decision A1)
// — NO service_role key. Re-checks admin server-side. No AI call.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/config";
import { runIngest } from "@/lib/ingest/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  // Per-request client carrying the caller's JWT → RLS evaluates is_admin()
  // against their identity, so admin writes to `roles` pass.
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await client.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }
  if (!isAdminEmail(userData.user.email)) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  try {
    const summary = await runIngest(client);
    return NextResponse.json(summary);
  } catch {
    // Never echo keys or raw upstream bodies.
    return NextResponse.json({ error: "Ingest failed. Check server logs." }, { status: 500 });
  }
  // TODO(v2): Vercel Cron for automatic daily sync (crons in vercel config).
}
