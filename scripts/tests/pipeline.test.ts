import assert from "node:assert/strict";
import { dedupe, classifyExpiry } from "@/lib/ingest/pipeline";
import type { RawJob, ExistingRole } from "@/lib/ingest/types";

const base = { title: "Product Manager", company: "Acme", location: "Remote", jd_text: "x", apply_url: "u" };

// Same company/title/location from two sources → one row kept, ATS preferred.
const deduped = dedupe([
  { ...base, source: "adzuna", external_id: "a1" } as RawJob,
  { ...base, source: "greenhouse", external_id: "g1" } as RawJob,
]);
assert.equal(deduped.length, 1);
assert.equal(deduped[0].source, "greenhouse");

// Distinct jobs are all kept.
const two = dedupe([
  { ...base, source: "greenhouse", external_id: "g1" } as RawJob,
  { ...base, title: "Senior PM", source: "greenhouse", external_id: "g2" } as RawJob,
]);
assert.equal(two.length, 2);

// Richer JD wins across sources for the same (company, title, location).
const richer = dedupe([
  { ...base, source: "greenhouse", external_id: "g1", jd_text: "short" } as RawJob,
  { ...base, source: "adzuna", external_id: "a1", jd_text: "a much longer and richer job description" } as RawJob,
]);
assert.equal(richer.length, 1);
assert.equal(richer[0].source, "adzuna", "longer jd_text should win over source rank");

// Tie on JD length → fall back to source rank (greenhouse > lever > adzuna).
const tie = dedupe([
  { ...base, source: "adzuna", external_id: "a1", jd_text: "same" } as RawJob,
  { ...base, source: "greenhouse", external_id: "g1", jd_text: "same" } as RawJob,
]);
assert.equal(tie.length, 1);
assert.equal(tie[0].source, "greenhouse", "equal jd_text must fall back to SOURCE_ORDER");

const existing: ExistingRole[] = [
  { id: "greenhouse:g1", source: "greenhouse", is_live: true },
  { id: "lever:l9", source: "lever", is_live: true },
  { id: "adzuna:a5", source: "adzuna", is_live: true },
];

// Baseline: ids absent from the fresh pull expire, when no source is skipped.
assert.deepEqual(
  classifyExpiry(existing, ["greenhouse:g1"], []).sort(),
  ["adzuna:a5", "lever:l9"]
);

// THE STAGE 8 BUG: adzuna failed this run → its rows must NOT expire.
assert.deepEqual(
  classifyExpiry(existing, ["greenhouse:g1"], ["adzuna"]),
  ["lever:l9"],
  "a skipped source must never be expired"
);

// Already-dead rows aren't re-expired (keeps the `expired` count honest).
const halfDead: ExistingRole[] = [{ id: "lever:l9", source: "lever", is_live: false }];
assert.deepEqual(classifyExpiry(halfDead, [], []), []);

console.log("pipeline: all assertions passed");
