import assert from "node:assert/strict";
import { isPmTitle, normalizeJob } from "@/lib/ingest/normalize";
import type { RawJob } from "@/lib/ingest/types";

// PM-title filter: keep real PM titles, exclude project/program manager.
assert.equal(isPmTitle("Senior Product Manager"), true);
assert.equal(isPmTitle("Associate Product Manager (APM)"), true);
assert.equal(isPmTitle("Group Product Manager"), true);
assert.equal(isPmTitle("Program Manager"), false);
assert.equal(isPmTitle("Technical Project Manager"), false);
assert.equal(isPmTitle("Data Analyst"), false);

// normalizeJob maps a RawJob into a full Role row.
const raw: RawJob = {
  source: "greenhouse",
  external_id: "4012345",
  title: "Product Manager, Growth",
  company: "Acme",
  location: "Bengaluru",
  jd_text: "Own acquisition and activation funnels; define the roadmap.",
  apply_url: "https://boards.greenhouse.io/acme/jobs/4012345",
};
const now = new Date("2026-07-07T00:00:00Z");
const role = normalizeJob(raw, now);
assert.equal(role.id, "greenhouse:4012345");
assert.equal(role.source, "greenhouse");
assert.equal(role.external_id, "4012345");
assert.equal(role.apply_url, raw.apply_url);
assert.equal(role.is_referral, false);
assert.equal(role.has_warm_path, false);
assert.equal(role.is_live, true);
assert.equal(role.crowd_response_days, 14);
assert.equal(role.ingested_at, now.toISOString());
assert.ok(Array.isArray(role.real_pm_signals) && role.real_pm_signals.length > 0);
assert.ok(role.real_pm_score >= 0 && role.real_pm_score <= 100);

console.log("normalize: all assertions passed");
