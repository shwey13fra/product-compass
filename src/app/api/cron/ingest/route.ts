// Stage 12 — daily cron ingestion. GET (Vercel cron sends GET, not POST).
//
// AUTH: Vercel automatically attaches `Authorization: Bearer $CRON_SECRET` when
// CRON_SECRET is set in the project env. We fail CLOSED when it is unset — a
// missing env var must NEVER leave this endpoint open.
//
// WRITES: signs in a dedicated bot user and forwards ITS JWT to the SHARED
// runIngest() pipeline, so RLS (is_admin() or is_ingest_bot()) stays the single
// write gate — the same one the admin "Sync jobs now" button goes through.
// NO service_role key. NO publicly-callable SECURITY DEFINER RPC (that would be
// grantable only to anon, whose key is public → world-writable `roles`).
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runIngest } from "@/lib/ingest/pipeline";
import { writeSyncRun } from "@/lib/ingest/syncRuns";
import { trackServer } from "@/lib/analytics";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    await logError("api/cron/ingest", "CRON_SECRET not configured (failing closed)", {});
    return NextResponse.json({ error: "Not configured." }, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.INGEST_BOT_EMAIL;
  const password = process.env.INGEST_BOT_PASSWORD;
  if (!url || !anon || !email || !password) {
    await logError("api/cron/ingest", "missing supabase or bot env", {});
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  // Per-request client carrying the bot's JWT → RLS evaluates is_ingest_bot().
  const bot = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: signInErr } = await bot.auth.signInWithPassword({ email, password });
  if (signInErr) {
    // Never echo the password or the raw auth error.
    await logError("api/cron/ingest", "bot sign-in failed", {});
    return NextResponse.json({ error: "Ingest auth failed." }, { status: 500 });
  }

  try {
    const summary = await runIngest(bot);
    const run_id = await writeSyncRun(bot, "cron", summary);
    await trackServer("ingest_run", {
      trigger: "cron",
      added: summary.added,
      updated: summary.updated,
      expired: summary.expired,
      sources_ok: Object.values(summary.bySource).filter((s) => s.ok).length,
      sources_failed: Object.values(summary.bySource).filter((s) => !s.ok).length,
    });
    return NextResponse.json({ run_id, ...summary });
  } catch {
    // Never echo keys or raw upstream bodies.
    await logError("api/cron/ingest", "ingest threw", {});
    return NextResponse.json({ error: "Ingest failed." }, { status: 500 });
  } finally {
    await bot.auth.signOut();
  }
}
