// Stage 8 — rule-based real-PM scorer. Pure JS, NO AI calls (protects credits).
// Mirrors CLAUDE.md's rubric: + owns discovery / what & why / an outcome metric
// · − delivery / coordination / ticket throughput. Bands via getBand(): 70+
// genuine · 40–69 verify · <40 disguised. Rougher than the hand-authored seed
// scores — the "Sourced" badge keeps that honest.

import type { Archetype } from "@/lib/types";

type SignalGroup = { weight: number; label: string; keywords: string[] };

const POSITIVE: SignalGroup[] = [
  {
    weight: 22,
    label: "owns discovery & user research",
    keywords: ["discovery", "user research", "customer interview", "user needs", "problem space", "jobs to be done", "user insight"],
  },
  {
    weight: 22,
    label: "decides what to build and why",
    keywords: ["define the roadmap", "own the roadmap", "product strategy", "what to build", "product vision", "prioriti", "set the direction", "shape the roadmap"],
  },
  {
    weight: 20,
    label: "owns an outcome metric",
    keywords: ["north star", "outcome metric", "own the metric", "activation", "retention", "conversion", "engagement metric", "business outcome", "own kpi"],
  },
];

const NEGATIVE: SignalGroup[] = [
  {
    weight: 18,
    label: "delivery & coordination focus",
    keywords: ["coordinate delivery", "cross-team coordination", "stakeholder management", "delivery-focused", "execution-focused", "coordinate across"],
  },
  {
    weight: 18,
    label: "ticket / throughput focus",
    keywords: ["ticket", "backlog grooming", "sprint management", "story points", "throughput", "jira"],
  },
  {
    weight: 16,
    label: "requirements & timelines, not what/why",
    keywords: ["gather requirements", "requirements gathering", "manage timelines", "release governance", "release management", "project plan", "on time and on budget"],
  },
];

export type RealPmResult = { score: number; signals: string[] };

export function scoreRealPm(title: string, jd: string): RealPmResult {
  const text = `${title}\n${jd}`.toLowerCase();
  let score = 50; // neutral base
  const signals: string[] = [];

  for (const g of POSITIVE) {
    if (g.keywords.some((k) => text.includes(k))) {
      score += g.weight;
      signals.push(g.label);
    }
  }
  for (const g of NEGATIVE) {
    if (g.keywords.some((k) => text.includes(k))) {
      score -= g.weight;
      signals.push(g.label);
    }
  }

  score = Math.max(0, Math.min(100, score));
  if (signals.length === 0) signals.push("limited signal in the description");
  return { score, signals };
}

// Best-effort archetype from title + JD keywords. Order matters (most specific
// first); defaults to b2c when nothing matches.
const ARCHETYPE_KEYWORDS: [Archetype, string[]][] = [
  ["ai", ["ai ", "a.i.", "machine learning", " ml ", "llm", "genai", "generative", "nlp", "model quality"]],
  ["zero_to_one", ["0 to 1", "0-1", "zero to one", "new product", "greenfield", "from scratch", "mvp"]],
  ["growth", ["growth", "acquisition", "activation", "funnel", "experimentation", "monetiz", "monetis"]],
  ["technical", ["api", "sdk", "developer experience", "infrastructure", "system design", "backend"]],
  ["platform", ["platform", "internal tool", "data platform", "self-serve"]],
  ["b2b", ["b2b", "enterprise", "saas", "merchant", "business customer"]],
  ["b2c", ["consumer", "b2c", "mobile app", "marketplace", "shopper"]],
];

export function inferArchetype(title: string, jd: string): Archetype {
  const text = ` ${title}\n${jd} `.toLowerCase();
  for (const [archetype, kws] of ARCHETYPE_KEYWORDS) {
    if (kws.some((k) => text.includes(k))) return archetype;
  }
  return "b2c";
}
