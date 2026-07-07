// Stage 8 — PM-title filter + RawJob → Role normalization.

import type { Role } from "@/lib/types";
import type { RawJob } from "./types";
import { scoreRealPm, inferArchetype } from "../realPmScore";

// Generic crowd-response default for ingested roles (we have no real crowd
// data for them — the seeded roles carry hand-set values).
const INGESTED_CROWD_DAYS = 14;

export function isPmTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (t.includes("project manager") || t.includes("program manager")) return false;
  return (
    t.includes("product manager") ||
    t.includes("product management") ||
    t.includes("associate product") ||
    t.includes("group product") ||
    t.includes("principal product") ||
    t.includes("head of product") ||
    t.includes("director of product") ||
    /\bapm\b/.test(t)
  );
}

export function normalizeJob(raw: RawJob, now: Date = new Date()): Role {
  const { score, signals } = scoreRealPm(raw.title, raw.jd_text);
  const iso = now.toISOString();
  return {
    id: `${raw.source}:${raw.external_id}`,
    company: raw.company,
    title: raw.title,
    archetype: inferArchetype(raw.title, raw.jd_text),
    real_pm_score: score,
    real_pm_signals: signals,
    is_live: true,
    freshness_checked_at: iso,
    location: raw.location,
    jd_text: raw.jd_text,
    crowd_response_days: INGESTED_CROWD_DAYS,
    has_warm_path: false,
    warm_path_note: null,
    is_referral: false,
    referrer_email: null,
    source: raw.source,
    external_id: raw.external_id,
    apply_url: raw.apply_url,
    ingested_at: iso,
  };
}
