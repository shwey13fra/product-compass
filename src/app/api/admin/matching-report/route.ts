// Stage 18 — admin-gated matching report. Reads aggregated event metrics via the
// admin_matching_report() RPC, which is SECURITY DEFINER and self-gates on
// is_admin(). We pass the caller's JWT through a scoped client so auth.jwt() (and
// thus is_admin()) resolves to the signed-in admin — a non-admin token gets a 403.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  const auth = req.headers.get("authorization");
  if (!auth || !/^bearer /i.test(auth)) {
    return NextResponse.json({ error: "Sign in as an admin." }, { status: 401 });
  }

  const token = auth.slice(7).trim();
  const scoped = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await scoped.rpc("admin_matching_report");
  if (error) {
    const status = /not authorized/i.test(error.message) ? 403 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json(data);
}
