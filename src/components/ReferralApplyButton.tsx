"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  UserCheck,
  LogIn,
  Loader2,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { Role } from "@/lib/types";
import { useUser } from "@/lib/auth";
import {
  findReferralApplication,
  createReferralApplication,
  type ReferralApplication,
} from "@/lib/referrals";
import { statusLabel } from "@/lib/applications";
import { loadBrief } from "@/lib/positioning";
import { track } from "@/lib/analytics";

// Referral roles require sign-in to apply. Applying creates a SHARED application
// linking this referee to the role's tagged referrer (a private thread + status
// strip). Signed out → prompt to sign in (returns here). Already applied → link
// to the thread.
export function ReferralApplyButton({
  role,
  surface,
  rank,
}: {
  role: Role;
  surface?: string;
  rank?: number;
}) {
  const { user, loading } = useUser();
  const router = useRouter();
  const [existing, setExisting] = useState<ReferralApplication | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setChecked(true);
      return;
    }
    let active = true;
    findReferralApplication(role.id, user.id).then((res) => {
      if (!active) return;
      if (res.ok) setExisting(res.data);
      setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [user, loading, role.id]);

  async function apply() {
    if (!user) return;
    setBusy(true);
    setError(null);
    const res = await createReferralApplication(
      role.id,
      user.id,
      role.referrer_email ?? ""
    );
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    track("applied", {
      role_id: role.id,
      had_brief: loadBrief(role.id) !== null,
      surface: surface ?? "direct",
      ...(rank != null ? { rank } : {}),
    });
    // Stage 13: no "did you use the brief?" prompt on this path — we redirect to
    // the thread immediately (below), so a prompt would unmount before it was
    // seen. Covering the warm path means putting the question on /referrals/[id].
    // /admin/quality therefore labels its usage rate cold-path only.
    // TODO(v2): prompt on the thread page once referral volume justifies it.
    router.push(`/referrals/${res.data.id}`);
  }

  const referrer = role.referrer_email;

  // Loading the session / existing application.
  if (loading || !checked) {
    return <div className="mt-4 h-12 animate-pulse rounded-card bg-surface-alt" aria-hidden />;
  }

  // Signed out — prompt to sign in (and come back here).
  if (!user) {
    return (
      <div className="mt-4 rounded-card border border-primary/30 bg-primary-soft/50 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <UserCheck className="h-4 w-4 text-primary" aria-hidden />
          This is a referral role
        </p>
        <p className="mt-1 text-sm text-muted">
          Applying connects you privately with the referrer
          {referrer ? <> (<span className="font-medium text-ink">{referrer}</span>)</> : null}.
          Sign in to apply.
        </p>
        <Link
          href={`/signin?next=${encodeURIComponent(`/roles/${role.id}`)}`}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          <LogIn className="h-4 w-4" aria-hidden />
          Sign in to apply
        </Link>
      </div>
    );
  }

  // Already applied — link to the shared thread.
  if (existing) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-success/30 bg-success-soft/50 px-4 py-3">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
          Referral · {statusLabel(existing.status)}
        </p>
        <Link
          href={`/referrals/${existing.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary-hover"
        >
          Open shared thread
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    );
  }

  // Signed in, not yet applied.
  return (
    <div className="mt-4 rounded-card border border-primary/30 bg-primary-soft/40 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <UserCheck className="h-4 w-4 text-primary" aria-hidden />
        Referral available
        {referrer ? (
          <span className="font-normal text-muted">
            via <span className="font-medium text-ink">{referrer}</span>
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-sm text-muted">
        Applying opens a private status strip + thread shared only with the
        referrer.
      </p>
      <button
        type="button"
        onClick={apply}
        disabled={busy}
        className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-5 text-sm font-semibold text-white shadow-[var(--shadow-warm)] transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <UserCheck className="h-4 w-4" aria-hidden />
        )}
        Apply via referral
      </button>
      {error ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}
