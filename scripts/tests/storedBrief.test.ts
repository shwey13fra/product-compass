// Stage 13 — StoredBrief.mode must be additive: a brief saved BEFORE this stage
// (version 1, no mode) must still load. loadBrief guards `version !== 1`, so a
// version bump would silently wipe every saved brief on every device.
import assert from "node:assert/strict";
import { saveBrief, loadBrief, type Brief, type FitRead } from "@/lib/positioning";

// Minimal localStorage shim — positioning.ts guards on `typeof window`.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const brief: Brief = { lead_story: "s", reangled_metrics: ["m"], background: ["b"], pitch_60s: "p" };
const fit: FitRead = { matchPct: 60, covered: ["Strategy & roadmap"], framable: [], archetypeAligned: true };

// 1. A pre-Stage-13 brief (version 1, NO mode) must still load.
store.set(
  "compass_brief:legacy",
  JSON.stringify({
    version: 1,
    roleId: "legacy",
    brief,
    fit,
    rawJson: "{}",
    savedAt: "2026-07-01T00:00:00.000Z",
  })
);
const legacy = loadBrief("legacy");
assert.ok(legacy, "a version-1 brief saved before mode existed must still load");
assert.equal(legacy!.mode, undefined, "legacy brief has no mode");

// 2. A new brief persists its mode and round-trips.
saveBrief("r-live", brief, fit, "{}", "live");
assert.equal(loadBrief("r-live")!.mode, "live");
saveBrief("r-manual", brief, fit, "{}", "manual");
assert.equal(loadBrief("r-manual")!.mode, "manual");

// 3. Version stays 1 — the guard must keep passing.
assert.equal(loadBrief("r-live")!.version, 1, "version must NOT be bumped");

console.log("storedBrief: all assertions passed");
