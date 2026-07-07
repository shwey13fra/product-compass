import assert from "node:assert/strict";
import { scoreRealPm, inferArchetype } from "@/lib/realPmScore";

// A genuine, discovery-and-outcome-owning JD should land in the "genuine" band.
const genuine = scoreRealPm(
  "Senior Product Manager, Discovery",
  "Own the discovery and roadmap for search. Define what to build and why from user research, run experiments, and own activation and retention as your north star metric."
);
assert.ok(genuine.score >= 70, `expected genuine >= 70, got ${genuine.score}`);
assert.ok(genuine.signals.length > 0, "genuine should have signals");

// A delivery/coordination JD should land in the "disguised" band.
const disguised = scoreRealPm(
  "Product Manager (Delivery)",
  "Coordinate delivery across squads. Gather requirements from stakeholders, manage timelines and release governance, and drive sprint ticket throughput."
);
assert.ok(disguised.score < 40, `expected disguised < 40, got ${disguised.score}`);

// Never returns an empty signals array (UI would show "No signals").
const thin = scoreRealPm("Product Manager", "");
assert.ok(thin.signals.length > 0, "thin JD still returns a signal");

// Archetype inference.
assert.equal(inferArchetype("PM, LLM Products", "Own LLM eval and model quality."), "ai");
assert.equal(inferArchetype("Growth PM", "Own acquisition and activation funnels."), "growth");
assert.equal(inferArchetype("Product Manager", "Consumer mobile app."), "b2c");

console.log("realPmScore: all assertions passed");
