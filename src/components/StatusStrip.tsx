"use client";

import { Check, Loader2 } from "lucide-react";
import {
  STATUS_STEPS,
  statusIndex,
  type ApplicationStatus,
} from "@/lib/applications";

// The 5-step status strip. Click any step to set the application to it
// (manual advance — v1 has no real "Seen" signal). Setting "Closed" confirms
// first (terminal + destructive-ish). `busy` disables interaction while saving.
//
// Tailwind can't generate classes from interpolated strings (see PAST_MISTAKES),
// so each visual state maps to a full static class string.
const STEP_STATE = {
  done: "bg-primary-soft text-primary ring-1 ring-primary/20",
  current: "bg-primary text-white shadow-[var(--shadow-warm)]",
  todo: "bg-surface-alt text-muted ring-1 ring-border",
} as const;

export function StatusStrip({
  status,
  busy,
  onChange,
  allowed,
  hint,
  closeConfirm,
}: {
  status: ApplicationStatus;
  busy: boolean;
  onChange: (next: ApplicationStatus) => void;
  // If given, only these stages are settable by this viewer (others show but
  // aren't clickable). Omit to allow all (the anonymous /tracking flow).
  allowed?: ApplicationStatus[];
  hint?: string;
  // Custom confirm text for the Closed step. The default assumes you can re-open
  // by picking another status; pass an override where you can't (e.g. admin).
  closeConfirm?: string;
}) {
  const currentIdx = statusIndex(status);
  const canSet = (s: ApplicationStatus) => !allowed || allowed.includes(s);

  function handleClick(next: ApplicationStatus) {
    if (busy || next === status || !canSet(next)) return;
    if (next === "closed") {
      const ok = window.confirm(
        closeConfirm ??
          "Mark this application as Closed? You can still re-open it by picking another status."
      );
      if (!ok) return;
    }
    onChange(next);
  }

  return (
    <div>
      <ol className="flex flex-wrap items-center gap-1.5">
        {STATUS_STEPS.map((step, i) => {
          const stateKey =
            i < currentIdx ? "done" : i === currentIdx ? "current" : "todo";
          const isCurrent = i === currentIdx;
          const settable = canSet(step.key) && !isCurrent;
          return (
            <li key={step.key} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleClick(step.key)}
                disabled={busy || !settable}
                aria-current={isCurrent ? "step" : undefined}
                title={
                  !canSet(step.key) ? "The referrer updates this stage" : undefined
                }
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${STEP_STATE[stateKey]} ${busy ? "opacity-60" : ""} ${settable && !busy ? "cursor-pointer" : "cursor-default"}`}
              >
                {i < currentIdx && <Check className="h-3.5 w-3.5" aria-hidden />}
                {isCurrent && busy && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                )}
                {step.label}
              </button>
              {i < STATUS_STEPS.length - 1 && (
                <span
                  className={`h-px w-3 ${i < currentIdx ? "bg-primary/40" : "bg-border"}`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-muted">
        {hint ?? "Tap a stage to update where this stands."}
      </p>
    </div>
  );
}
