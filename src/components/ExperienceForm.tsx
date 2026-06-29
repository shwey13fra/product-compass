"use client";

import { useState } from "react";
import { Save, X } from "lucide-react";
import {
  ALL_ARCHETYPES,
  archetypeLabel,
  type Archetype,
} from "@/lib/types";
import {
  emptyExperience,
  type ExperienceProfile,
} from "@/lib/experience";

// The "My Experience" form. Filled once, saved to localStorage by the parent.
// Controlled, with light validation (experience text is required).

export function ExperienceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: ExperienceProfile | null;
  onSave: (p: ExperienceProfile) => void;
  onCancel?: () => void;
}) {
  const seed = initial ?? emptyExperience();
  const [name, setName] = useState(seed.name);
  const [headline, setHeadline] = useState(seed.headline);
  const [experience, setExperience] = useState(seed.experience);
  const [archetype, setArchetype] = useState<Archetype | null>(seed.archetype);
  const [touched, setTouched] = useState(false);

  const experienceValid = experience.trim().length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!experienceValid) return;
    onSave({
      version: 1,
      name: name.trim(),
      headline: headline.trim(),
      experience: experience.trim(),
      archetype,
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="exp-name">
          <input
            id="exp-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Priya Sharma"
            className={inputCls}
          />
        </Field>
        <Field label="Headline" htmlFor="exp-headline">
          <input
            id="exp-headline"
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="PM · 4 yrs · fintech & payments"
            className={inputCls}
          />
        </Field>
      </div>

      <Field
        label="Preferred archetype"
        htmlFor="exp-archetype"
        hint="The kind of PM work you're aiming for."
      >
        <select
          id="exp-archetype"
          value={archetype ?? ""}
          onChange={(e) =>
            setArchetype((e.target.value || null) as Archetype | null)
          }
          className={inputCls}
        >
          <option value="">No preference</option>
          {ALL_ARCHETYPES.map((a) => (
            <option key={a} value={a}>
              {archetypeLabel(a)}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Your experience"
        htmlFor="exp-text"
        hint="Roles, the problems you owned, real outcomes and metrics. The more concrete, the sharper the positioning."
        required
      >
        <textarea
          id="exp-text"
          value={experience}
          onChange={(e) => setExperience(e.target.value)}
          onBlur={() => setTouched(true)}
          rows={7}
          placeholder={
            "e.g. Led discovery + 0→1 launch of a UPI autopay flow at a fintech (~2M MAU). Ran 6 user interviews/week, shipped an A/B test that lifted activation 18%. Owned the roadmap with 3 engineers; coordinated with risk & compliance."
          }
          className={`${inputCls} resize-y leading-relaxed ${
            touched && !experienceValid ? "ring-1 ring-danger/50" : ""
          }`}
          aria-invalid={touched && !experienceValid}
        />
        {touched && !experienceValid && (
          <p className="mt-1.5 text-xs font-medium text-danger">
            Add a few lines about your experience to position from.
          </p>
        )}
      </Field>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white shadow-[var(--shadow-warm)] transition-colors hover:bg-primary-hover"
        >
          <Save className="h-4 w-4" aria-hidden />
          Save my experience
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-3 text-sm font-medium text-muted transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden />
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-btn border border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted/70 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-semibold text-ink"
      >
        {label}
        {required && <span className="ml-0.5 text-primary">*</span>}
      </label>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
