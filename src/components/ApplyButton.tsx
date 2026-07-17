"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, CheckCircle2, ArrowRight, AlertTriangle } from "lucide-react";
import { getCompassUid } from "@/lib/compass-uid";
import {
  getApplication,
  setStatus,
  statusLabel,
  type ApplicationStatus,
} from "@/lib/applications";
import { loadBrief, type StoredBrief } from "@/lib/positioning";
import { track } from "@/lib/analytics";
import { BriefUsedPrompt } from "@/components/BriefUsedPrompt";

// Role-detail CTA: "Mark as Applied". Once applied, it flips to a confirmation
// that links to /tracking (the strip + nudges live there). Persists to Supabase
// keyed by compass_uid, so the state survives reloads.
export function ApplyButton({ roleId }: { roleId: string }) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatusState] = useState<ApplicationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stage 13: set only right after a successful apply, so the prompt asks once
  // rather than on every visit to an already-applied role.
  const [askUsed, setAskUsed] = useState<StoredBrief | null>(null);

  useEffect(() => {
    let cancelled = false;
    const uid = getCompassUid();
    if (!uid) {
      setMounted(true);
      return;
    }
    getApplication(uid, roleId).then((res) => {
      if (cancelled) return;
      if (res.ok && res.application) setStatusState(res.application.status);
      setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  async function markApplied() {
    const uid = getCompassUid();
    if (!uid) return;
    setBusy(true);
    setError(null);
    const res = await setStatus(uid, roleId, "applied");
    if (!res.ok || !res.application) {
      setError(res.ok ? "Could not save." : res.error);
    } else {
      setStatusState(res.application.status);
      const savedBrief = loadBrief(roleId);
      // had_brief powers "% of applications sent with a brief" (docs/METRICS.md).
      track("applied", { role_id: roleId, had_brief: savedBrief !== null });
      // Stage 13: had_brief says a brief EXISTED; this asks whether it was USED.
      // The gap between those two numbers is the point of /admin/quality.
      if (savedBrief) setAskUsed(savedBrief);
    }
    setBusy(false);
  }

  if (!mounted) {
    return (
      <div className="mt-4 h-12 animate-pulse rounded-card bg-surface-alt" aria-hidden />
    );
  }

  if (status) {
    return (
      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-success/30 bg-success-soft/50 px-4 py-3">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            Tracking · {statusLabel(status)}
          </p>
          <Link
            href="/tracking"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary-hover"
          >
            View in Tracking
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {askUsed && (
          <BriefUsedPrompt
            roleId={roleId}
            mode={askUsed.mode}
            onDone={() => setAskUsed(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={markApplied}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-5 text-sm font-semibold text-white shadow-[var(--shadow-warm)] transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Check className="h-4 w-4" aria-hidden />
        )}
        Mark as Applied
      </button>
      {error && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
