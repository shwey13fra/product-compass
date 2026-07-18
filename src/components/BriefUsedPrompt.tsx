"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { resolveOwnerKey } from "@/lib/owner";
import { track } from "@/lib/analytics";
import { reportBriefUsed, resolveBriefMode } from "@/lib/briefFeedback";

// Stage 13 — one question, once, after Mark as Applied. Dismissible: dismissing
// leaves used_in_application NULL, which is why that column is nullable. Never
// blocks the apply — the application is already saved by the time this renders.
export function BriefUsedPrompt({
  roleId,
  mode,
  onDone,
}: {
  roleId: string;
  mode: "live" | "manual" | undefined;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function answer(used: boolean) {
    const uid = await resolveOwnerKey();
    if (!uid) return onDone();
    setBusy(true);
    await reportBriefUsed(uid, roleId, resolveBriefMode(mode), used);
    track("brief_used_reported", { role_id: roleId, used });
    setBusy(false);
    onDone();
  }

  return (
    <div className="mt-3 rounded-card border border-border bg-surface-alt px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink">
          Did you use the positioning brief in this application?
        </p>
        <button
          type="button"
          onClick={onDone}
          aria-label="Dismiss"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => answer(true)}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-btn border border-border bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-success/40 hover:text-success disabled:opacity-60"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => answer(false)}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-btn border border-border bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-muted disabled:opacity-60"
        >
          No
        </button>
      </div>
    </div>
  );
}
