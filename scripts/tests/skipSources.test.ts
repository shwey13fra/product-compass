import assert from "node:assert/strict";
import { computeSkipSources } from "@/lib/ingest/pipeline";
import type { JobSource, SourceStat } from "@/lib/ingest/types";

const stats = (o: Partial<Record<JobSource, SourceStat>>): Record<JobSource, SourceStat> => ({
  greenhouse: { fetched: 5, ok: true },
  lever: { fetched: 5, ok: true },
  adzuna: { fetched: 5, ok: true },
  ...o,
});
const live = (o: Partial<Record<JobSource, number>>): Record<JobSource, number> => ({
  greenhouse: 10,
  lever: 10,
  adzuna: 10,
  ...o,
});

// Healthy run → nothing skipped.
assert.deepEqual(computeSkipSources(stats({}), live({})).skip, []);

// A source that errored is skipped (the real Stage 8 bug).
const failed = computeSkipSources(stats({ adzuna: { fetched: 0, ok: false } }), live({}));
assert.deepEqual(failed.skip, ["adzuna"]);
assert.equal(failed.warnings.length, 1);
assert.ok(failed.warnings[0].includes("adzuna"));

// Circuit breaker: 200 OK but zero rows while rows are live → skip + warn.
const zero = computeSkipSources(stats({ adzuna: { fetched: 0, ok: true } }), live({}));
assert.deepEqual(zero.skip, ["adzuna"]);
assert.ok(zero.warnings[0].includes("0 jobs"));

// Circuit breaker does NOT fire for a genuinely new/empty source.
const fresh = computeSkipSources(stats({ lever: { fetched: 0, ok: true } }), live({ lever: 0 }));
assert.deepEqual(fresh.skip, []);
assert.deepEqual(fresh.warnings, []);

console.log("skipSources: all assertions passed");
