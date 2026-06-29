"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchX, SlidersHorizontal, Sparkles, ChevronDown } from "lucide-react";
import type { Role } from "@/lib/types";
import { ALL_ARCHETYPES, archetypeLabel, type Archetype } from "@/lib/types";
import {
  type Preferences,
  type MatchResult,
  loadPreferences,
  savePreferences,
  clearPreferences,
  isOnboardingDismissed,
  dismissOnboarding,
  preferencesSummary,
  scoreRole,
} from "@/lib/preferences";
import { RoleCard } from "@/components/RoleCard";
import { OnboardingModal } from "@/components/OnboardingModal";

type ArchetypeFilter = "all" | Archetype;
type Scored = { role: Role; match: MatchResult | null };

// Client component: owns Stage 2 filters + Stage 2.5 personalisation.
// Data is fetched on the server and passed in via props.
export function RolesBrowser({ roles }: { roles: Role[] }) {
  // Stage 2.5 personalisation. `prefs` starts null so server + first client
  // render agree (browse mode); real prefs load from localStorage post-mount
  // and the list re-ranks. This keeps the roles server-rendered.
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [onboarding, setOnboarding] = useState<null | "first" | "edit">(null);
  const [showAll, setShowAll] = useState(false);

  // Stage 2 filters (unchanged behaviour, applied on top of personalisation)
  const [archetype, setArchetype] = useState<ArchetypeFilter>("all");
  const [hideDisguised, setHideDisguised] = useState(false);

  // Read saved prefs after mount (localStorage is client-only). Offer the
  // questionnaire on first visit, but never block the list behind it.
  useEffect(() => {
    const saved = loadPreferences();
    setPrefs(saved);
    if (!saved && !isOnboardingDismissed()) setOnboarding("first");
  }, []);

  const handleSave = (p: Preferences) => {
    savePreferences(p);
    setPrefs(p);
    setOnboarding(null);
    setShowAll(false);
    // TODO(v2): log saved onboarding answers (anon owner_key) so we can later
    // correlate which answers/domains/filters precede actual applications.
  };

  const handleSkip = () => {
    if (onboarding === "first") dismissOnboarding();
    setOnboarding(null);
  };

  const handleReset = () => {
    clearPreferences();
    setPrefs(null);
    setShowAll(false);
  };

  const presentArchetypes = useMemo(() => {
    const set = new Set(roles.map((r) => r.archetype));
    return ALL_ARCHETYPES.filter((a) => set.has(a));
  }, [roles]);

  // 1) Stage 2 filters. "genuine only" pref also hard-filters <40.
  const filtered = useMemo(() => {
    const genuineOnly = hideDisguised || (prefs?.genuineOnly ?? false);
    return roles.filter((r) => {
      if (archetype !== "all" && r.archetype !== archetype) return false;
      if (genuineOnly && r.real_pm_score < 40) return false;
      return true;
    });
  }, [roles, archetype, hideDisguised, prefs]);

  // 2) Score + sort. No prefs → rank by real_pm_score (Stage 2 behaviour).
  const scored: Scored[] = useMemo(() => {
    if (!prefs) {
      return [...filtered]
        .sort((a, b) => b.real_pm_score - a.real_pm_score)
        .map((role) => ({ role, match: null }));
    }
    return filtered
      .map((role) => ({ role, match: scoreRole(role, prefs) }))
      .sort((a, b) => b.match!.score - a.match!.score);
  }, [filtered, prefs]);

  // 3) Split into top matches (strong/good) vs the rest (still ranked).
  const topMatches = useMemo(
    () => (prefs ? scored.filter((s) => s.match!.fit !== "partial") : []),
    [scored, prefs]
  );
  const rest = useMemo(
    () => (prefs ? scored.filter((s) => s.match!.fit === "partial") : []),
    [scored, prefs]
  );

  // TODO(v2): log active filter combination alongside applications to learn
  // which (archetype + location + genuine-only) combos convert best.

  return (
    <div>
      {/* Personalisation bar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-[var(--shadow-warm)]">
        {prefs ? (
          <p className="inline-flex items-center gap-2 text-sm text-ink">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            <span>
              Personalised · <span className="text-muted">{preferencesSummary(prefs)}</span>
            </span>
          </p>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm text-muted">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Get roles ranked for you — answer a few quick questions.
          </p>
        )}
        <div className="flex items-center gap-2">
          {prefs && (
            <button
              type="button"
              onClick={handleReset}
              className="text-sm font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={() => setOnboarding(prefs ? "edit" : "first")}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            {prefs ? "Edit preferences" : "Personalise"}
          </button>
        </div>
      </div>

      {/* Stage 2 filters */}
      <div className="mb-6 rounded-card border border-border bg-surface px-4 py-4 shadow-[var(--shadow-warm)] sm:px-5">
        <div className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          Filters
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip active={archetype === "all"} onClick={() => setArchetype("all")}>
            All archetypes
          </FilterChip>
          {presentArchetypes.map((a) => (
            <FilterChip key={a} active={archetype === a} onClick={() => setArchetype(a)}>
              {archetypeLabel(a)}
            </FilterChip>
          ))}
        </div>

        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2.5 text-sm text-ink">
          <button
            type="button"
            role="switch"
            aria-checked={hideDisguised}
            onClick={() => setHideDisguised((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              hideDisguised ? "bg-primary" : "bg-border"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform ${
                hideDisguised ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          Hide disguised PM roles (under 40)
        </label>
      </div>

      {/* Results */}
      {scored.length === 0 ? (
        <EmptyResults hideDisguised={hideDisguised || !!prefs?.genuineOnly} />
      ) : !prefs ? (
        // Browse mode (no personalisation): one ranked grid.
        <>
          <p className="mb-4 text-sm text-muted">{countLabel(scored.length, archetype, hideDisguised)}</p>
          <Grid items={scored} />
        </>
      ) : topMatches.length > 0 ? (
        // Personalised: top matches first, rest behind a toggle.
        <>
          <SectionHeading
            title="Top matches for you"
            subtitle={`${topMatches.length} ${topMatches.length === 1 ? "role" : "roles"} aligned to your preferences`}
          />
          <Grid items={topMatches} />

          {rest.length > 0 && (
            <div className="mt-8">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-btn border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-primary/40"
              >
                {showAll ? "Hide other roles" : `View all roles (${rest.length} more)`}
                <ChevronDown className={`h-4 w-4 transition-transform ${showAll ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {showAll && (
                <div className="mt-5">
                  <SectionHeading title="Other roles" subtitle="Still ranked by your fit score" />
                  <Grid items={rest} />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        // Personalised but nothing cleared the "top match" bar.
        <>
          <div className="mb-4 rounded-card border border-info/30 bg-info-soft px-4 py-3 text-sm text-ink">
            No strong matches for these preferences yet — here&apos;s everything, ranked by your fit score.
          </div>
          <Grid items={scored} />
        </>
      )}

      {/* Onboarding (optional, non-blocking) */}
      {onboarding && (
        <OnboardingModal
          initial={prefs}
          mode={onboarding}
          onSave={handleSave}
          onSkip={handleSkip}
        />
      )}
    </div>
  );
}

function Grid({ items }: { items: Scored[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(({ role, match }) => (
        <RoleCard key={role.id} role={role} match={match ?? undefined} />
      ))}
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-heading text-xl font-bold text-ink">{title}</h2>
      <p className="text-sm text-muted">{subtitle}</p>
    </div>
  );
}

function countLabel(n: number, archetype: ArchetypeFilter, hideDisguised: boolean) {
  let s = `${n} ${n === 1 ? "role" : "roles"}`;
  if (archetype !== "all") s += ` · ${archetypeLabel(archetype)}`;
  if (hideDisguised) s += " · disguised hidden";
  return s;
}

function EmptyResults({ hideDisguised }: { hideDisguised: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-surface-alt px-6 py-16 text-center">
      <SearchX className="h-8 w-8 text-muted" aria-hidden />
      <h3 className="mt-4 font-heading text-lg font-bold text-ink">No roles match these filters</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted">
        Try a different archetype{hideDisguised ? ", or turn off the “genuine only / hide disguised” filters." : "."}
      </p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-white"
          : "bg-surface-alt text-muted hover:bg-primary-soft hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}
