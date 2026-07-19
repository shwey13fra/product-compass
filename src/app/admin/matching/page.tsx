"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, Compass, Loader2, AlertTriangle, Target, ListOrdered, Crosshair } from "lucide-react";
import { useUser, isAdminEmail } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { AuthNav } from "@/components/AuthNav";

// Stage 18 — admin matching report. Reads the three numbers via the admin-gated
// /api/admin/matching-report (which reads the INSERT-only events via a SECURITY
// DEFINER RPC). Numbers stay empty until real traffic generates events.

type PerUser = {
  identity: string;
  applications: number;
  top_pct: number | null;
  avg_rank: number | null;
  archetype_match_pct: number | null;
};
type Report = {
  total_applications: number;
  by_surface: Record<string, number>;
  avg_rank: number | null;
  archetype_match_rate: number | null;
  per_user: PerUser[];
};

export default function MatchingPage() {
  const { user, loading } = useUser();
  const admin = isAdminEmail(user?.email);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setError("Session expired — sign in again.");
        return;
      }
      try {
        const res = await fetch("/api/admin/matching-report", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "Failed to load report.");
          return;
        }
        setReport(body as Report);
      } catch {
        if (!cancelled) setError("Network error loading report.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [admin]);

  const total = report?.total_applications ?? 0;
  const topShare =
    report && total > 0 ? Math.round((100 * (report.by_surface.top ?? 0)) / total) : null;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex items-center justify-between gap-3">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Compass className="h-4 w-4" aria-hidden />
          Admin
        </Link>
        <AuthNav />
      </header>

      <h1 className="inline-flex items-center gap-2 font-heading text-3xl font-extrabold tracking-tight text-ink">
        <Shield className="h-7 w-7 text-primary" aria-hidden />
        Matching report
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        How applications relate to ranking + stated preference. Read-only — proposes
        nothing. See <code className="text-xs">docs/MATCHING_FINDINGS.md</code> before any weight change.
      </p>

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking access…
        </div>
      ) : !admin ? (
        <div className="mt-8 rounded-card border border-border bg-surface-alt px-6 py-10 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-accent" aria-hidden />
          <h2 className="mt-3 font-heading text-lg font-bold text-ink">Admins only</h2>
        </div>
      ) : error ? (
        <p className="mt-8 inline-flex items-center gap-1.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error}
        </p>
      ) : report === null ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : total === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border bg-surface-alt px-6 py-12 text-center">
          <Target className="mx-auto h-7 w-7 text-muted" aria-hidden />
          <h2 className="mt-3 font-heading text-lg font-bold text-ink">No applications yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
            Capture is live — the three numbers populate as real users view roles and apply.
            Nothing to analyze until then.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              icon={Target}
              label="From Top matches"
              value={topShare != null ? `${topShare}%` : "—"}
              sub={`${report.by_surface.top ?? 0} top · ${report.by_surface.all ?? 0} all · ${report.by_surface.direct ?? 0} direct`}
            />
            <Stat
              icon={ListOrdered}
              label="Avg applied rank"
              value={report.avg_rank != null ? String(report.avg_rank) : "—"}
              sub="Lower = applied to higher-ranked roles"
            />
            <Stat
              icon={Crosshair}
              label="Archetype match"
              value={report.archetype_match_rate != null ? `${report.archetype_match_rate}%` : "—"}
              sub="Applied archetype vs stated preference"
            />
          </div>

          <h2 className="mt-8 font-heading text-lg font-bold text-ink">Per user</h2>
          <div className="mt-3 overflow-x-auto rounded-card border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5">Identity</th>
                  <th className="px-4 py-2.5">Apps</th>
                  <th className="px-4 py-2.5">% Top</th>
                  <th className="px-4 py-2.5">Avg rank</th>
                  <th className="px-4 py-2.5">Archetype match</th>
                </tr>
              </thead>
              <tbody>
                {report.per_user.map((u) => (
                  <tr key={u.identity} className="border-b border-border last:border-0">
                    <td className="max-w-[180px] truncate px-4 py-2.5 font-mono text-xs text-muted" title={u.identity}>
                      {u.identity}
                    </td>
                    <td className="px-4 py-2.5 text-ink">{u.applications}</td>
                    <td className="px-4 py-2.5 text-ink">{u.top_pct != null ? `${u.top_pct}%` : "—"}</td>
                    <td className="px-4 py-2.5 text-ink">{u.avg_rank ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink">
                      {u.archetype_match_pct != null ? `${u.archetype_match_pct}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)]">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </p>
      <p className="mt-2 font-heading text-3xl font-extrabold text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}
