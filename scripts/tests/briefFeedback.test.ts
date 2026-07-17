// Stage 13 — pure validation for brief feedback. No network, no AI.
import assert from "node:assert/strict";
import { resolveBriefMode, validateNote, NOTE_MAX } from "@/lib/briefFeedback";

// A brief saved before Stage 13 has no mode — it must report 'unknown', never a
// guess. A wrong mode would silently corrupt the live-vs-manual comparison that
// is the entire point of /admin/quality.
assert.equal(resolveBriefMode(undefined), "unknown");
assert.equal(resolveBriefMode("live"), "live");
assert.equal(resolveBriefMode("manual"), "manual");

// Notes: trimmed, empty becomes null, over-long is rejected at the boundary.
assert.deepEqual(validateNote(null), { ok: true, note: null });
assert.deepEqual(validateNote("   "), { ok: true, note: null });
assert.deepEqual(validateNote("  too generic  "), { ok: true, note: "too generic" });

const long = validateNote("x".repeat(NOTE_MAX + 1));
assert.equal(long.ok, false, "a note over the cap must be rejected, not silently truncated client-side");

assert.equal(validateNote("x".repeat(NOTE_MAX)).ok, true, "exactly at the cap is fine");

console.log("briefFeedback: all assertions passed");
