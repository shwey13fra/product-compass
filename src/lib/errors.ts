// Stage 10 — server-side error logger. Our zero-cost alternative to Sentry:
// writes to the Supabase `errors` table (INSERT-only RLS, see
// scripts/stage10-analytics.sql) instead of adding a paid/heavy client SDK.
//
// Use ONLY from server code (route handlers). Fire-and-forget in spirit, but
// AWAIT it on error paths so the row is flushed before a serverless function
// can freeze. Never throws. Never pass secrets or PII in `detail` — status
// codes, flags, and short sanitized messages only (never the API key, request
// body, or model output, which is derived from the user's experience).

import { supabase } from "@/lib/supabase";

export async function logError(
  source: string,
  message: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  try {
    await supabase.from("errors").insert({ source, message, detail });
  } catch {
    // Last resort: never let logging break the request it's reporting on.
  }
}
