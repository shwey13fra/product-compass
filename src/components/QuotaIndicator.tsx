"use client";

// Stage 16 — free/pro quota surfaces near the "Position me" button.
//  * QuotaIndicator: pre-click chip ("N of 3 free briefs left" / "Pro · unlimited").
//  * UpgradePanel: shown when a free user is out of briefs. Records the WTP signal
//    (upgrade_intent) and fires quota_exhausted once on show. Manual paste-in is
//    offered right here as the unlimited free alternative.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Crown, Gauge, ClipboardPaste, Sparkles, Check, LogIn } from "lucide-react";
import { useUser } from "@/lib/auth";
import { track } from "@/lib/analytics";

export type QuotaState = {
  plan: "free" | "pro";
  limit: number | null; // null = unlimited (Pro)
  used: number;
  remaining: number | null; // null = unlimited (Pro)
};

export function QuotaIndicator({ quota }: { quota: QuotaState }) {
  if (quota.plan === "pro") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
        <Crown className="h-3.5 w-3.5" aria-hidden />
        Pro · unlimited live briefs
      </span>
    );
  }

  const remaining = quota.remaining ?? 0;
  const limit = quota.limit ?? 0;
  const tone =
    remaining === 0
      ? "bg-danger-soft text-danger"
      : remaining === 1
      ? "bg-accent-soft text-accent"
      : "bg-surface-alt text-muted";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
      <Gauge className="h-3.5 w-3.5" aria-hidden />
      {remaining} of {limit} free {limit === 1 ? "brief" : "briefs"} left this month
    </span>
  );
}

export function UpgradePanel({
  plan,
  onManual,
}: {
  plan: "free" | "pro";
  onManual: () => void;
}) {
  const { user } = useUser();
  const [interested, setInterested] = useState(false);

  // Fire quota_exhausted exactly once when the panel becomes visible.
  const firedRef = useRef(false);
  useEffect(() => {
    if (!firedRef.current) {
      firedRef.current = true;
      track("quota_exhausted", { plan });
    }
  }, [plan]);

  function handleInterested() {
    track("upgrade_intent", { plan });
    setInterested(true);
  }

  return (
    <div className="rounded-card border border-primary/30 bg-primary-soft p-4 sm:p-5">
      <h3 className="inline-flex items-center gap-2 font-heading text-sm font-bold text-ink">
        <Crown className="h-4 w-4 text-primary" aria-hidden />
        You&apos;re out of free briefs this month
      </h3>
      <p className="mt-1.5 text-sm text-ink">
        <span className="font-semibold">Product Compass Pro</span> gives you{" "}
        <span className="font-semibold">unlimited live briefs</span> — reposition
        for as many roles as you like, whenever you like.
      </p>
      <p className="mt-1 text-xs text-muted">
        Everything else stays free: discovery, fit read, freshness, crowd stats,
        tracking, and the manual paste-in.
      </p>

      {interested ? (
        <div className="mt-4 flex items-start gap-2 rounded-btn border border-success/30 bg-success-soft px-3.5 py-3 text-sm text-success">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Thanks — noted. We&apos;ll be in touch when Pro opens up. Meanwhile,
            the manual paste-in below is unlimited and free.
          </span>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleInterested}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white shadow-[var(--shadow-warm)] transition-colors hover:bg-primary-hover"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              I&apos;m interested in Pro
            </button>
            <button
              type="button"
              onClick={onManual}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-3 text-sm font-medium text-muted transition-colors hover:text-primary"
            >
              <ClipboardPaste className="h-4 w-4" aria-hidden />
              Paste it in manually (free)
            </button>
          </div>
          {!user && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
              <LogIn className="h-3.5 w-3.5" aria-hidden />
              Pro is linked to your account —{" "}
              <Link
                href="/signin?next=/roles"
                className="font-semibold text-primary hover:text-primary-hover"
              >
                sign in
              </Link>{" "}
              to be first in line.
            </p>
          )}
        </>
      )}
    </div>
  );
}
