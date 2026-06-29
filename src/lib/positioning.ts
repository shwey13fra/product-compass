// Stage 3 — MANUAL positioning. NO AI calls in this file.
// Responsibilities:
//   1. buildPositioningPrompt() — assemble the prompt from CLAUDE.md's rules
//      using a role's JD + the saved experience + the role's archetype.
//   2. parseBrief() — robustly parse the JSON the user pastes back.
//   3. computeFitRead() — a pure-JS rough % match + the "framable 30%".
//   4. localStorage persistence of generated briefs, keyed per role.
//
// The live Anthropic call (app/api/position/route.ts) gets wired on top of
// this in a later stage — the manual paste-in path must work with zero credits.

import type { Role } from "@/lib/types";
import { archetypeLabel } from "@/lib/types";
import type { ExperienceProfile } from "@/lib/experience";

// --- Brief shape (CLAUDE.md): {lead_story, reangled_metrics[], background[], pitch_60s}

export type Brief = {
  lead_story: string;
  reangled_metrics: string[];
  background: string[];
  pitch_60s: string;
};

// --- Prompt assembly ---------------------------------------------------------
// Faithful to CLAUDE.md's AI rules: JSON-only output; never fabricate or
// keyword-stuff; change portrayal not facts; address credibility gaps head-on.

export function buildPositioningPrompt(role: Role, p: ExperienceProfile): string {
  const jd = (role.jd_text ?? "").trim() || "(no job description provided)";
  const candidateArchetype = p.archetype ? archetypeLabel(p.archetype) : "(unspecified)";

  return `You are a positioning strategist for product managers. Your job is to reframe a PM's REAL experience so it lands for one specific role's context. Change the portrayal, never the facts.

RULES
- Never fabricate experience, titles, or metrics. Use only what the candidate gives you.
- Do not keyword-stuff the job description back at the reader.
- Re-angle real metrics toward what THIS role rewards.
- Address credibility gaps head-on — name them, don't paper over them.
- Output JSON ONLY. No prose, no markdown, no code fences.

ROLE
Company: ${role.company}
Title: ${role.title}
Role archetype (positioning target): ${archetypeLabel(role.archetype)}
Job description:
"""
${jd}
"""

CANDIDATE
Name: ${p.name || "(unspecified)"}
Headline: ${p.headline || "(unspecified)"}
Their preferred archetype: ${candidateArchetype}
Experience:
"""
${p.experience.trim()}
"""

TASK
Produce a positioning brief that makes this candidate's real experience the obvious fit for the role above.

Return JSON in EXACTLY this shape:
{
  "lead_story": "string — the single strongest narrative to lead with for THIS role",
  "reangled_metrics": ["string — a real metric from the candidate, re-angled to this role's priorities"],
  "background": ["string — something true about the candidate to de-emphasise / move to the background for this role"],
  "pitch_60s": "string — a tight ~60-second spoken pitch tailored to this role"
}`;
}

// --- Parsing the pasted JSON -------------------------------------------------

export type ParseResult =
  | { ok: true; brief: Brief }
  | { ok: false; error: string };

function extractJsonObject(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  // Strip ```json ... ``` or ``` ... ``` fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Fall back to the first balanced {...} span.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

export function parseBrief(raw: string): ParseResult {
  const json = extractJsonObject(raw);
  if (!json) {
    return { ok: false, error: "Couldn't find a JSON object. Paste the full { ... } result." };
  }

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "That isn't valid JSON. Check for stray text or a missing brace." };
  }

  const lead_story = typeof obj.lead_story === "string" ? obj.lead_story.trim() : "";
  const pitch_60s = typeof obj.pitch_60s === "string" ? obj.pitch_60s.trim() : "";
  const reangled_metrics = toStringArray(obj.reangled_metrics);
  const background = toStringArray(obj.background);

  if (!lead_story && !pitch_60s && reangled_metrics.length === 0 && background.length === 0) {
    return {
      ok: false,
      error:
        "JSON parsed but none of the expected fields were found (lead_story, reangled_metrics, background, pitch_60s).",
    };
  }

  return { ok: true, brief: { lead_story, reangled_metrics, background, pitch_60s } };
}

// --- Fit read (pure JS, no AI) ----------------------------------------------
// A rough % match + the "framable 30%" the candidate doesn't yet cover.
// We bucket PM competencies into themes, detect which the JD asks for, then
// check which of those the candidate's experience already evidences.

type Theme = { id: string; label: string; keywords: string[] };

const THEMES: Theme[] = [
  { id: "discovery", label: "User discovery & research", keywords: ["discovery", "user research", "interview", "customer", "user need", "problem space", "jobs to be done"] },
  { id: "data", label: "Data & experimentation", keywords: ["metric", "kpi", "analytic", "data-driven", "experiment", "a/b", "ab test", "funnel", "retention", "conversion", "cohort"] },
  { id: "strategy", label: "Strategy & roadmap", keywords: ["strategy", "roadmap", "vision", "prioriti", "okr", "north star"] },
  { id: "execution", label: "Delivery & execution", keywords: ["ship", "launch", "deliver", "execution", "sprint", "agile", "scrum", "release"] },
  { id: "stakeholder", label: "Stakeholder & cross-functional", keywords: ["stakeholder", "cross-functional", "cross functional", "influence", "align", "leadership", "communicat"] },
  { id: "technical", label: "Technical / platform depth", keywords: ["api", "technical", "architecture", "platform", "engineering", "infrastructure", "system design", "sdk", "backend"] },
  { id: "growth", label: "Growth & GTM", keywords: ["growth", "acquisition", "activation", "monetiz", "monetis", "gtm", "go-to-market", "marketing", "revenue", "pricing"] },
  { id: "ai", label: "AI / ML", keywords: ["ai", "ml", "machine learning", "llm", "model", "recommendation", "generative", "nlp"] },
  { id: "zero_to_one", label: "0→1 / new product", keywords: ["0 to 1", "0-1", "zero to one", "mvp", "new product", "greenfield", "from scratch", "early stage"] },
  { id: "b2b", label: "B2B / enterprise", keywords: ["b2b", "enterprise", "saas", "sales", "customer success", "procurement"] },
  { id: "b2c", label: "Consumer / B2C", keywords: ["b2c", "consumer", "mobile app", "engagement", "viral", "dau", "mau"] },
];

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

export type FitRead = {
  matchPct: number; // rough 0–100
  covered: string[]; // JD themes the candidate already evidences
  framable: string[]; // the "framable 30%" — JD themes not yet covered
  archetypeAligned: boolean;
};

export function computeFitRead(role: Role, p: ExperienceProfile): FitRead {
  const jd = `${role.title} ${role.jd_text ?? ""}`.toLowerCase();
  const exp = `${p.headline} ${p.experience}`.toLowerCase();

  const jdThemes = THEMES.filter((t) => hasAny(jd, t.keywords));
  // If the JD is too thin to detect themes, fall back to the role archetype.
  const themesToCheck = jdThemes.length > 0 ? jdThemes : THEMES.filter((t) => t.id === role.archetype);

  const covered: string[] = [];
  const framable: string[] = [];
  for (const t of themesToCheck) {
    if (hasAny(exp, t.keywords)) covered.push(t.label);
    else framable.push(t.label);
  }

  const archetypeAligned = p.archetype === role.archetype;

  const total = themesToCheck.length;
  const base = total > 0 ? (covered.length / total) * 100 : 50;
  // Small nudge for archetype alignment, clamped to a sensible band.
  const raw = base + (archetypeAligned ? 8 : 0);
  const matchPct = Math.max(10, Math.min(95, Math.round(raw)));

  return {
    matchPct,
    covered,
    framable: framable.slice(0, 3), // surface the top gaps — the framable 30%
    archetypeAligned,
  };
}

// --- Brief persistence (per role, across reloads) ---------------------------

export type StoredBrief = {
  version: 1;
  roleId: string;
  brief: Brief;
  fit: FitRead;
  rawJson: string; // what the user pasted, so they can re-open/edit
  savedAt: string; // ISO
};

const briefKey = (roleId: string) => `compass_brief:${roleId}`;

export function loadBrief(roleId: string): StoredBrief | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(briefKey(roleId));
    if (!raw) return null;
    const b = JSON.parse(raw) as StoredBrief;
    if (b?.version !== 1) return null;
    return b;
  } catch {
    return null;
  }
}

export function saveBrief(
  roleId: string,
  brief: Brief,
  fit: FitRead,
  rawJson: string
): StoredBrief {
  const stored: StoredBrief = {
    version: 1,
    roleId,
    brief,
    fit,
    rawJson,
    savedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(briefKey(roleId), JSON.stringify(stored));
  }
  return stored;
}

export function clearBrief(roleId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(briefKey(roleId));
}
