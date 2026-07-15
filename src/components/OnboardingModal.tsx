"use client";

import { useEffect, useState } from "react";
import { X, Sparkles, Compass } from "lucide-react";
import { ALL_ARCHETYPES, archetypeLabel, type Archetype } from "@/lib/types";
import {
  type Preferences,
  type Seniority,
  type WorkMode,
  type Energiser,
  type Industry,
  SENIORITY_LABELS,
  WORKMODE_LABELS,
  ENERGISER_LABELS,
  INDUSTRY_LABELS,
  deriveArchetypes,
  insightText,
  emptyPreferences,
} from "@/lib/preferences";
import { track } from "@/lib/analytics";

// Optional onboarding questionnaire. Never blocks the app: the parent renders
// the full list underneath, and this offers a "Browse all roles instead" exit.

type Props = {
  initial: Preferences | null;
  mode: "first" | "edit";
  onSave: (prefs: Preferences) => void;
  onSkip: () => void; // dismiss without saving (first-time) / cancel (edit)
};

export function OnboardingModal({ initial, mode, onSave, onSkip }: Props) {
  const seed = initial ?? emptyPreferences();
  const [roleTitle, setRoleTitle] = useState(seed.roleTitle);
  const [seniority, setSeniority] = useState<Seniority | null>(seed.seniority);
  const [domains, setDomains] = useState<Archetype[]>(seed.domains);
  const [notSure, setNotSure] = useState(seed.notSure);
  const [energisers, setEnergisers] = useState<Energiser[]>(seed.energisers);
  const [industries, setIndustries] = useState<Industry[]>(seed.industries);
  const [location, setLocation] = useState<WorkMode | null>(seed.location);
  const [genuineOnly, setGenuineOnly] = useState(seed.genuineOnly);

  // Esc closes (counts as skip/cancel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSkip();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  // When in "not sure" mode, derive archetypes from Q3 and pre-select them
  // (still editable via the Q2 chips below).
  const derived = deriveArchetypes(energisers, industries);
  useEffect(() => {
    if (notSure) setDomains(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notSure, energisers, industries]);

  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const handleSave = () => {
    const prefs: Preferences = {
      version: 1,
      completedAt: new Date().toISOString(),
      roleTitle: roleTitle.trim(),
      seniority,
      domains,
      notSure,
      energisers,
      industries,
      location,
      genuineOnly,
    };
    track("onboarding_completed");
    onSave(prefs);
  };

  const insight = notSure ? insightText(derived) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onSkip}
      role="dialog"
      aria-modal="true"
      aria-label="Personalise your roles"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-card bg-surface shadow-xl sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Compass className="h-4.5 w-4.5" aria-hidden />
            </span>
            <div>
              <h2 className="font-heading text-lg font-bold text-ink">
                {mode === "edit" ? "Edit your preferences" : "Personalise your roles"}
              </h2>
              <p className="text-xs text-muted">Optional — takes about a minute.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Close"
            className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-alt hover:text-ink"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* Q1 */}
          <Field label="What role are you targeting?">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SENIORITY_LABELS) as Seniority[]).map((s) => (
                <Chip key={s} active={seniority === s} onClick={() => setSeniority(s)}>
                  {SENIORITY_LABELS[s]}
                </Chip>
              ))}
            </div>
            <input
              type="text"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="Target title (optional), e.g. Growth PM"
              className="mt-3 w-full rounded-btn border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none"
            />
          </Field>

          {/* Q2 */}
          <Field label="Which domains interest you?" hint="Pick any that fit.">
            <div className="flex flex-wrap gap-2">
              {ALL_ARCHETYPES.map((a) => (
                <Chip
                  key={a}
                  active={domains.includes(a)}
                  onClick={() => {
                    setNotSure(false);
                    setDomains((d) => toggle(d, a));
                  }}
                >
                  {archetypeLabel(a)}
                </Chip>
              ))}
              <Chip active={notSure} onClick={() => setNotSure((v) => !v)} variant="dashed">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Not sure — help me figure it out
              </Chip>
            </div>
          </Field>

          {/* Q3 — only when "Not sure" */}
          {notSure && (
            <div className="space-y-5 rounded-card border border-accent/30 bg-accent-soft/40 p-4">
              <Field label="What energises you?">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(ENERGISER_LABELS) as Energiser[]).map((e) => (
                    <Chip
                      key={e}
                      active={energisers.includes(e)}
                      onClick={() => setEnergisers((l) => toggle(l, e))}
                    >
                      {ENERGISER_LABELS[e]}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label="Which industries excite you?">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(INDUSTRY_LABELS) as Industry[]).map((i) => (
                    <Chip
                      key={i}
                      active={industries.includes(i)}
                      onClick={() => setIndustries((l) => toggle(l, i))}
                    >
                      {INDUSTRY_LABELS[i]}
                    </Chip>
                  ))}
                </div>
              </Field>

              {insight && (
                <div className="rounded-btn bg-surface px-3 py-2.5 text-sm">
                  <p className="font-semibold text-ink">
                    <Sparkles className="mr-1.5 inline h-4 w-4 text-accent" aria-hidden />
                    {insight}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Pre-selected above — toggle the chips to adjust.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Q4 */}
          <Field label="Location & work mode">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(WORKMODE_LABELS) as WorkMode[]).map((w) => (
                <Chip key={w} active={location === w} onClick={() => setLocation(w)}>
                  {WORKMODE_LABELS[w]}
                </Chip>
              ))}
            </div>
            <label className="mt-3 flex w-fit cursor-pointer items-center gap-2.5 text-sm text-ink">
              <button
                type="button"
                role="switch"
                aria-checked={genuineOnly}
                onClick={() => setGenuineOnly((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  genuineOnly ? "bg-primary" : "bg-border"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-surface shadow transition-transform ${
                    genuineOnly ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
              Show only genuine product roles
            </label>
          </Field>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm font-medium text-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
          >
            {mode === "edit" ? "Cancel" : "Browse all roles instead"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex min-h-11 items-center rounded-btn bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            {mode === "edit" ? "Save changes" : "Show my matches"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{label}</h3>
      {hint && <p className="mb-2 mt-0.5 text-xs text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  variant = "solid",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "solid" | "dashed";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-white"
          : variant === "dashed"
            ? "border border-dashed border-border bg-surface text-muted hover:border-primary hover:text-primary"
            : "bg-surface-alt text-muted hover:bg-primary-soft hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}
