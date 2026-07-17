// Stage 13 — computeFitRead. Guards the three defects found on 2026-07-17:
//   1. "ai"/"ml" substring-matched ordinary English ("failed", "email").
//   2. archetype `platform` had no THEME to fall back to.
//   3. a thin JD collapsed the denominator to one theme -> a fabricated 10%/95%.
import assert from "node:assert/strict";
import { computeFitRead } from "@/lib/positioning";
import type { Role, Archetype } from "@/lib/types";
import type { ExperienceProfile } from "@/lib/experience";

const role = (over: Partial<Role>): Role =>
  ({
    id: "r1",
    company: "Acme",
    title: "Product Manager",
    archetype: "b2c",
    jd_text: "",
    ...over,
  }) as Role;

const prof = (experience: string, archetype: Archetype | null = null): ExperienceProfile => ({
  version: 1,
  name: "T",
  headline: "",
  experience,
  archetype,
  updatedAt: "2026-07-17T00:00:00.000Z",
});

// A JD that explicitly asks for AI/ML plus enough other themes to be scoreable.
const aiJd = role({
  archetype: "ai",
  jd_text:
    "Own our machine learning surface. Also: strategy, roadmap, user interviews, metrics, launch, stakeholder alignment.",
});

// --- 1. Word-boundary matching ----------------------------------------------
// "ai" must not match inside failed/email/maintain/domain; "ml" not inside html.

for (const exp of [
  "Cut failed transactions by 30%.",
  "Ran an email campaign.",
  "I maintain the details.",
  "Worked on the supply chain domain.",
  "We aim to help. I aid the team. Fresh air.",
  "Wrote html templates.",
]) {
  const fit = computeFitRead(aiJd, prof(exp));
  assert.ok(
    !fit.covered.includes("AI / ML"),
    `false positive: "${exp}" must not claim AI / ML experience`
  );
}

// ...but a real AI/ML claim still counts (guard against over-correcting).
assert.ok(
  computeFitRead(aiJd, prof("Shipped an ML model for recommendations.")).covered.includes("AI / ML"),
  "real ML experience must still be detected"
);
assert.ok(
  computeFitRead(aiJd, prof("I led AI products.")).covered.includes("AI / ML"),
  "the standalone token AI must still be detected"
);

// Prefix + plural matching must survive the boundary fix.
const strategyJd = role({
  jd_text: "Own prioritisation, the roadmap, user interviews, metrics, launches, and stakeholder alignment.",
});
assert.ok(
  computeFitRead(strategyJd, prof("Drove prioritisation across the org.")).covered.includes("Strategy & roadmap"),
  '"prioriti" must still prefix-match "prioritisation"'
);
assert.ok(
  computeFitRead(strategyJd, prof("Ran discovery interviews with users.")).covered.includes("User discovery & research"),
  '"interview" must still match the plural "interviews"'
);
assert.ok(
  computeFitRead(
    role({ jd_text: "Run a/b tests on the funnel. Own roadmap, interviews, launch, stakeholder align." }),
    prof("Ran a/b tests weekly.")
  ).covered.includes("Data & experimentation"),
  '"a/b" must still match'
);

// --- 2. Every archetype has a theme -----------------------------------------
// A thin JD forces the archetype fallback; `platform` used to fall back to
// nothing at all -> total = 0 -> a hardcoded 50%.

const ARCHETYPES: Archetype[] = ["ai", "growth", "technical", "platform", "b2b", "b2c", "zero_to_one"];
for (const a of ARCHETYPES) {
  const fit = computeFitRead(role({ archetype: a, jd_text: "Own the thing." }), prof("Led payments work."));
  assert.equal(
    fit.matchPct,
    null,
    `archetype ${a}: a thin JD must not produce a score (got ${fit.matchPct})`
  );
}

// --- 3. Thin JD -> honest low-confidence, not a fabricated number ------------

// The real role that floored in production (Zerodha Kite, 131-char JD).
const kite = role({
  company: "Zerodha",
  title: "Product Manager, Kite",
  archetype: "b2c",
  jd_text:
    "Own parts of the Kite trading experience. Deep user empathy with traders, define what to build, own usage and reliability outcomes.",
});
const richPm = prof(
  "Led payments. Ran user interviews, shipped checkout, lifted conversion 18%, ran a/b tests, owned the roadmap, retention +12%.",
  "b2b"
);

assert.equal(
  computeFitRead(kite, richPm).matchPct,
  null,
  "a 131-char JD cannot support a fit score — must return null, not 10%"
);

// The absurdity that proved the bug: one meaningless word must not beat a career.
assert.equal(
  computeFitRead(kite, prof("dau")).matchPct,
  null,
  'the single word "dau" must not score 95% on a thin JD'
);

// A JD with too few themes is still not scoreable (2 themes < the minimum).
assert.equal(
  computeFitRead(role({ jd_text: "Own the roadmap. Run user interviews." }), richPm).matchPct,
  null,
  "2 detected themes is too thin to score"
);

// ...but a JD with enough themes scores normally.
const scoreable = computeFitRead(
  role({ jd_text: "Own the roadmap. Run user interviews. Ship the launch." }),
  richPm
);
assert.equal(typeof scoreable.matchPct, "number", "3 detected themes must produce a score");
assert.ok(
  scoreable.matchPct! > 10 && scoreable.matchPct! <= 95,
  `a covered rich profile must score sensibly (got ${scoreable.matchPct})`
);

// A real fat JD must still score (regression guard for the happy path).
const fatJd = role({
  company: "Stripe",
  title: "Product Manager, Payments",
  archetype: "b2b",
  jd_text: `We are looking for a product manager to own the payments roadmap and strategy.
    You will run user research and customer interviews, define the vision, prioritise ruthlessly,
    partner cross-functionally with engineering on our api platform, own metrics and experiments
    including a/b tests on conversion and retention, and ship launches for our enterprise saas customers.`,
});
const fat = computeFitRead(fatJd, richPm);
assert.equal(typeof fat.matchPct, "number", "a fat JD must produce a score");
assert.ok(fat.covered.length >= 3, `a fat JD + rich profile should cover several themes (got ${fat.covered.length})`);

console.log("fitRead: all assertions passed");
