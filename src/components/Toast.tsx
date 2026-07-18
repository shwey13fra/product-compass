"use client";

// Stage 14 — a minimal, dependency-free toast (no toast lib in the project).
// Presentational + self-dismissing; the parent controls visibility by mounting
// it with a `message` and clearing that message in `onClose`. Warm-Clay tokens
// only, 44px close target, polite live region for screen readers.

import { useEffect } from "react";
import { Link2, X } from "lucide-react";

export function Toast({
  message,
  onClose,
  duration = 6000,
}: {
  message: string;
  onClose: () => void;
  duration?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [onClose, duration]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm items-start gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-[var(--shadow-warm)] sm:inset-x-auto sm:right-6 sm:left-auto"
    >
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Link2 className="h-4 w-4" aria-hidden />
      </span>
      <p className="flex-1 text-sm font-medium text-ink">{message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="-m-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-muted transition-colors hover:text-ink"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
