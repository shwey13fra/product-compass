// Shared domain types + display helpers for roles (Stage 2).
// The roles table is seeded & shared (no owner_key). Columns match CLAUDE.md.

export type Archetype =
  | "ai"
  | "growth"
  | "technical"
  | "platform"
  | "b2b"
  | "b2c"
  | "zero_to_one";

export type Role = {
  id: string;
  company: string;
  title: string;
  archetype: Archetype;
  real_pm_score: number; // 0–100
  real_pm_signals: string[] | null;
  is_live: boolean;
  freshness_checked_at: string | null; // ISO timestamp
  location: string | null;
  jd_text: string | null;
  crowd_response_days: number | null;
  has_warm_path: boolean;
  warm_path_note: string | null;
  // Stage 7 — referral roles posted by an admin; applying needs sign-in.
  is_referral: boolean;
  referrer_email: string | null;
  // Stage 8 — ingestion provenance. 'seed' = illustrative sample data;
  // 'greenhouse'|'lever'|'adzuna' = ingested from a live source.
  source: string | null;
  external_id: string | null;
  apply_url: string | null;
  ingested_at: string | null;
};

// --- Archetype display -------------------------------------------------------

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  ai: "AI",
  growth: "Growth",
  technical: "Technical",
  platform: "Platform",
  b2b: "B2B",
  b2c: "B2C",
  zero_to_one: "Zero to One",
};

export const ALL_ARCHETYPES = Object.keys(ARCHETYPE_LABELS) as Archetype[];

export function archetypeLabel(a: string): string {
  return ARCHETYPE_LABELS[a as Archetype] ?? a;
}

// --- Real-PM score band ------------------------------------------------------
// genuine 70+ (sage) · verify 40–69 (honey) · disguised <40 (brick)

export type Band = "genuine" | "verify" | "disguised";

export type BandMeta = {
  band: Band;
  label: string;
  // Tailwind utility groups built from Warm Clay semantic tokens.
  textClass: string;
  bgClass: string;
  ringClass: string;
};

export function getBand(score: number): BandMeta {
  if (score >= 70) {
    return {
      band: "genuine",
      label: "Genuine PM",
      textClass: "text-success",
      bgClass: "bg-success-soft",
      ringClass: "ring-success/30",
    };
  }
  if (score >= 40) {
    return {
      band: "verify",
      label: "Verify",
      textClass: "text-accent",
      bgClass: "bg-accent-soft",
      ringClass: "ring-accent/30",
    };
  }
  return {
    band: "disguised",
    label: "Disguised PM",
    textClass: "text-danger",
    bgClass: "bg-danger-soft",
    ringClass: "ring-danger/30",
  };
}

// --- Freshness ---------------------------------------------------------------
// "Verified live · checked X days ago"; stale roles flagged clearly.

const STALE_AFTER_DAYS = 30;

export type FreshnessMeta = {
  state: "fresh" | "stale" | "closed" | "unknown";
  label: string;
  daysAgo: number | null;
  textClass: string;
  bgClass: string;
};

export function getFreshness(
  isLive: boolean,
  checkedAt: string | null,
  now: Date = new Date()
): FreshnessMeta {
  if (!isLive) {
    return {
      state: "closed",
      label: "No longer live",
      daysAgo: null,
      textClass: "text-danger",
      bgClass: "bg-danger-soft",
    };
  }

  if (!checkedAt) {
    return {
      state: "unknown",
      label: "Freshness unknown",
      daysAgo: null,
      textClass: "text-muted",
      bgClass: "bg-surface-alt",
    };
  }

  const checked = new Date(checkedAt);
  const daysAgo = Math.max(
    0,
    Math.floor((now.getTime() - checked.getTime()) / 86_400_000)
  );
  const ago =
    daysAgo === 0 ? "today" : daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;

  if (daysAgo > STALE_AFTER_DAYS) {
    return {
      state: "stale",
      label: `Stale · last checked ${ago}`,
      daysAgo,
      textClass: "text-accent",
      bgClass: "bg-accent-soft",
    };
  }

  return {
    state: "fresh",
    label: `Verified live · checked ${ago}`,
    daysAgo,
    textClass: "text-success",
    bgClass: "bg-success-soft",
  };
}
