// Stage 13 — pure validation for brief feedback. No network, no AI.
//
// Why the dynamic import: briefFeedback.ts imports `supabase`, and
// src/lib/supabase.ts THROWS at module load if the env vars are absent
// (supabase.ts:12). tsx doesn't read .env.local, so a plain top-level import
// would crash before a single assertion ran. Dummy values are enough — nothing
// here makes a request; we only exercise the pure helpers.
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

async function main() {
  const { resolveBriefMode, validateNote, NOTE_MAX } = await import("@/lib/briefFeedback");

  // A brief saved before Stage 13 has no mode — it must report 'unknown', never
  // a guess. A wrong mode would silently corrupt the live-vs-manual comparison
  // that is the entire point of /admin/quality.
  assert.equal(resolveBriefMode(undefined), "unknown");
  assert.equal(resolveBriefMode("live"), "live");
  assert.equal(resolveBriefMode("manual"), "manual");

  // Notes: trimmed, empty becomes null, over-long rejected at the boundary.
  assert.deepEqual(validateNote(null), { ok: true, note: null });
  assert.deepEqual(validateNote("   "), { ok: true, note: null });
  assert.deepEqual(validateNote("  too generic  "), { ok: true, note: "too generic" });

  const long = validateNote("x".repeat(NOTE_MAX + 1));
  assert.equal(long.ok, false, "a note over the cap must be rejected, not silently truncated client-side");

  assert.equal(validateNote("x".repeat(NOTE_MAX)).ok, true, "exactly at the cap is fine");

  console.log("briefFeedback: all assertions passed");
}
main();
