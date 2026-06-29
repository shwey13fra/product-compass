// Stage 2.5 — onboarding preferences + a pure-JS personalised match score.
// NO AI calls here. All client-side; persisted to localStorage.
// Positioning/tracking are untouched by this module.

import type { Archetype, Role } from "@/lib/types";
import { archetypeLabel, getFreshness } from "@/lib/types";

export type Seniority = "apm" | "pm" | "senior_pm";
export type WorkMode = "mumbai" | "bangalore" | "remote" | "flexible";
export type Energiser =
  | "talk_users"
  | "dig_data"
  | "shape_architecture"
  | "build_0_to_1";
export type Industry =
  | "fintech"
  | "gaming"
  | "travel_food"
  | "hr_tech"
  | "consumer"
  | "enterprise";

export type Preferences = {
  version: 1;
  completedAt: string; // ISO
  roleTitle: string; // optional free text
  seniority: Seniority | null;
  domains: Archetype[]; // selected/derived archetypes of interest
  notSure: boolean; // took the "help me figure it out" path
  energisers: Energiser[];
  industries: Industry[];
  location: WorkMode | null;
  genuineOnly: boolean;
};

// --- Display labels ----------------------------------------------------------

export const SENIORITY_LABELS: Record<Seniority, string> = {
  apm: "APM",
  pm: "PM",
  senior_pm: "Senior PM",
};

export const WORKMODE_LABELS: Record<WorkMode, string> = {
  mumbai: "Mumbai",
  bangalore: "Bangalore",
  remote: "Remote",
  flexible: "Flexible",
};

export const ENERGISER_LABELS: Record<Energiser, string> = {
  talk_users: "Talk to users",
  dig_data: "Dig into data",
  shape_architecture: "Shape architecture",
  build_0_to_1: "Build 0→1",
};

export const INDUSTRY_LABELS: Record<Industry, string> = {
  fintech: "Fintech",
  gaming: "Gaming",
  travel_food: "Travel & food",
  hr_tech: "HR-tech",
  consumer: "Consumer",
  enterprise: "Enterprise",
};

// --- "Not sure" → archetype mapping -----------------------------------------
// Each answer contributes weight to one or more archetypes; we surface the top.

const ENERGISER_WEIGHTS: Record<Energiser, Partial<Record<Archetype, number>>> = {
  talk_users: { b2c: 2, b2b: 1, growth: 1 },
  dig_data: { growth: 2, ai: 1 },
  shape_architecture: { technical: 2, platform: 2 },
  build_0_to_1: { zero_to_one: 3 },
};

const INDUSTRY_WEIGHTS: Record<Industry, Partial<Record<Archetype, number>>> = {
  fintech: { b2c: 1, b2b: 1 },
  gaming: { b2c: 2 },
  travel_food: { b2c: 2 },
  hr_tech: { b2b: 2, platform: 1 },
  consumer: { b2c: 2 },
  enterprise: { b2b: 2, platform: 1 },
};

// Returns archetypes ordered by inferred interest (strongest first).
export function deriveArchetypes(
  energisers: Energiser[],
  industries: Industry[],
  max = 3
): Archetype[] {
  const totals = new Map<Archetype, number>();
  const add = (w?: Partial<Record<Archetype, number>>) => {
    if (!w) return;
    for (const [a, n] of Object.entries(w)) {
      totals.set(a as Archetype, (totals.get(a as Archetype) ?? 0) + (n ?? 0));
    }
  };
  energisers.forEach((e) => add(ENERGISER_WEIGHTS[e]));
  industries.forEach((i) => add(INDUSTRY_WEIGHTS[i]));

  return [...totals.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([a]) => a);
}

export function insightText(derived: Archetype[]): string | null {
  if (derived.length === 0) return null;
  const lead = derived.slice(0, 2).map(archetypeLabel).join(" / ");
  return `You seem to lean ${lead}`;
}

// --- Match scoring (pure JS, no AI) -----------------------------------------
// archetype match (highest weight) + location/work-mode + real_pm_score
// + a small freshness boost. Genuine roles naturally rise via real_pm_score.

export type Fit = "strong" | "good" | "partial";

export type MatchResult = {
  score: number;
  fit: Fit;
  archetypeMatched: boolean;
  locationMatched: boolean;
  isGenuine: boolean;
  reasons: string[]; // for the reason chip, e.g. ["B2C","Mumbai","genuine PM"]
};

const W_ARCHETYPE = 50;
const W_LOCATION = 20;
const W_REALPM = 30; // scaled from real_pm_score (0–100)
const FRESH_BOOST = { fresh: 8, unknown: 3, stale: 2, closed: -15 } as const;

function locationMatches(mode: WorkMode | null, roleLocation: string | null): boolean {
  if (!mode || mode === "flexible" || !roleLocation) return false; // flexible = no differentiator
  const loc = roleLocation.toLowerCase();
  if (mode === "remote") return loc.includes("remote");
  return loc.includes(mode); // "mumbai" / "bangalore"
}

export function scoreRole(role: Role, prefs: Preferences): MatchResult {
  const archetypeMatched = prefs.domains.includes(role.archetype);
  const locationMatched = locationMatches(prefs.location, role.location);
  const isGenuine = role.real_pm_score >= 70;
  const flexible = prefs.location === "flexible" || prefs.location === null;

  const freshness = getFreshness(role.is_live, role.freshness_checked_at).state;

  let score = 0;
  if (archetypeMatched) score += W_ARCHETYPE;
  if (locationMatched) score += W_LOCATION;
  score += (role.real_pm_score / 100) * W_REALPM;
  score += FRESH_BOOST[freshness];

  // Fit tag derived from the dimensions that actually aligned.
  // Disguised roles (<40) never qualify as a top match — that's the whole
  // point of the product — so they cap at "partial" regardless of fit.
  const disguised = role.real_pm_score < 40;
  let fit: Fit = "partial";
  if (disguised) {
    fit = "partial";
  } else if (archetypeMatched && isGenuine && (locationMatched || flexible)) {
    fit = "strong";
  } else if (archetypeMatched && (isGenuine || locationMatched || flexible)) {
    fit = "good";
  }

  const reasons: string[] = [];
  if (archetypeMatched) reasons.push(archetypeLabel(role.archetype));
  if (locationMatched && prefs.location) reasons.push(WORKMODE_LABELS[prefs.location]);
  if (isGenuine) reasons.push("genuine PM");

  return { score, fit, archetypeMatched, locationMatched, isGenuine, reasons };
}

// --- localStorage persistence -----------------------------------------------

const PREFS_KEY = "compass_preferences";
const DISMISSED_KEY = "compass_onboarding_dismissed";

export function loadPreferences(): Preferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Preferences;
    if (p?.version !== 1) return null;
    return p;
  } catch {
    return null;
  }
}

export function savePreferences(prefs: Preferences): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  window.localStorage.removeItem(DISMISSED_KEY); // saved = no longer dismissed
}

export function clearPreferences(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PREFS_KEY);
}

export function isOnboardingDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DISMISSED_KEY) === "1";
}

export function dismissOnboarding(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DISMISSED_KEY, "1");
}

export function emptyPreferences(): Preferences {
  return {
    version: 1,
    completedAt: new Date().toISOString(),
    roleTitle: "",
    seniority: null,
    domains: [],
    notSure: false,
    energisers: [],
    industries: [],
    location: null,
    genuineOnly: false,
  };
}

// Short human summary for the personalised header, e.g.
// "Senior PM · B2C, Growth · Mumbai".
export function preferencesSummary(p: Preferences): string {
  const parts: string[] = [];
  if (p.seniority) parts.push(SENIORITY_LABELS[p.seniority]);
  if (p.domains.length) parts.push(p.domains.map(archetypeLabel).join(", "));
  if (p.location) parts.push(WORKMODE_LABELS[p.location]);
  if (p.genuineOnly) parts.push("genuine only");
  return parts.join(" · ") || "No preferences set";
}
