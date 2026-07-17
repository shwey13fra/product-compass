"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, Compass, Loader2, AlertTriangle, ThumbsUp, ThumbsDown } from "lucide-react";
import { useUser, isAdminEmail } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { AuthNav } from "@/components/AuthNav";
import type { BriefFeedbackRow } from "@/lib/briefFeedback";

// Stage 13 — admin-only brief quality. Reads brief_feedback DIRECTLY: the
// "brief_feedback read admin" policy (using is_admin()) is the real gate; the
// email check below only decides what renders. Anon callers get nothing from
// this table at all — they can only reach their own row via the uid RPCs.
const MODES: BriefFeedbackRow["brief_mode"][] = ["live", "manual", "unknown"];

export default function QualityPage() {
  const { user, loading } = useUser();
  const admin = isAdminEmail(user?.email);
  const [rows, setRows] = useState<BriefFeedbackRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    supabase
      .from("brief_feedback")
      .select("id,uid,role_id,brief_mode,rating,used_in_application,note,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        setRows((data ?? []) as BriefFeedbackRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [admin]);

  const all = rows ?? [];
  const byMode = (m: string) => all.filter((r) => r.brief_mode === m);
  const up = (rs: BriefFeedbackRow[]) => rs.filter((r) => r.rating === "thumbs_up").length;
  const down = (rs: BriefFeedbackRow[]) => rs.filter((r) => r.rating === "thumbs_down").length;
  const asked = all.filter((r) => r.used_in_application !== null);
  const usedYes = asked.filter((r) => r.used_in_application === true).length;
  const notes = all.filter((r) => r.rating === "thumbs_down" && r.note).slice(0, 20);

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
        Brief quality
      </h1>

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking access…
        </div>
      ) : !admin ? (
        <div className="mt-8 rounded-card border border-border bg-surface-alt px-6 py-10 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-accent" aria-hidden />
          <h2 className="mt-3 font-heading text-lg font-bold text-ink">Admins only</h2>
          <p className="mt-1.5 text-sm text-muted">This view is for brief quality review.</p>
        </div>
      ) : rows === null ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : error ? (
        <p className="mt-8 inline-flex items-center gap-1.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error}
        </p>
      ) : all.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border bg-surface-alt px-6 py-10 text-center">
          <p className="text-sm text-muted">No feedback yet.</p>
          <p className="mt-1 text-xs text-muted">
            Generate a brief and rate it — it&apos;ll show up here.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
            <h2 className="font-heading text-lg font-bold text-ink">Ratings by mode</h2>
            <p className="mt-1 text-sm text-muted">
              With a handful of ratings this is descriptive, not evidence — don&apos;t read a
              live-vs-manual winner out of single digits.
            </p>
            <ul className="mt-4 divide-y divide-border">
              {MODES.map((m) => {
                const rs = byMode(m);
                return (
                  <li key={m} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="font-semibold text-ink">{m}</span>
                    <span className="inline-flex items-center gap-4">
                      <span className="inline-flex items-center gap-1.5 text-success">
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
                        {up(rs)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-danger">
                        <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
                        {down(rs)}
                      </span>
                      <span className="text-xs text-muted">{rs.length} total</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-muted">
              &ldquo;unknown&rdquo; = a brief saved before Stage 13, which never recorded its
              mode. Not a bug — we don&apos;t guess.
            </p>
          </section>

          <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
            <h2 className="font-heading text-lg font-bold text-ink">Usage</h2>
            <p className="mt-2 text-sm text-ink">
              <span className="font-bold">{usedYes}</span> of{" "}
              <span className="font-bold">{asked.length}</span> answered &ldquo;yes, I used
              it&rdquo;
              {asked.length > 0 && (
                <span className="text-muted">
                  {" "}
                  · {Math.round((usedYes / asked.length) * 100)}%
                </span>
              )}
            </p>
            <p className="mt-1.5 text-xs text-muted">
              Cold path only — the referral flow redirects on apply, so it is never asked.
              Dismissed prompts are excluded (used_in_application is null), so this is a rate
              among people who answered, not among everyone who applied.
            </p>
          </section>

          <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
            <h2 className="font-heading text-lg font-bold text-ink">Recent thumbs-down notes</h2>
            <p className="mt-1 text-sm text-muted">
              The only place this text lives — it never goes to `events`.
            </p>
            {notes.length === 0 ? (
              <p className="mt-3 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-btn border border-border bg-surface-alt px-3 py-2">
                    <p className="text-sm text-ink">{n.note}</p>
                    <p className="mt-1 text-xs text-muted">
                      {n.brief_mode} · {new Date(n.created_at).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
