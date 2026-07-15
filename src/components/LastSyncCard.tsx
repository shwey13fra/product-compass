"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getLatestSyncRun, type SyncRunRow } from "@/lib/ingest/syncRuns";

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Admin-only summary of the most recent ingest run (cron or manual). Reads
// sync_runs with the admin's session — RLS denies select to everyone else.
export function LastSyncCard() {
  const [rows, setRows] = useState<SyncRunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLatestSyncRun(supabase)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the last sync.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-danger">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        {error}
      </p>
    );
  }
  if (rows === null) {
    return <div className="mt-4 h-24 animate-pulse rounded-card bg-surface-alt" aria-hidden />;
  }
  if (rows.length === 0) {
    return <p className="mt-4 text-sm text-muted">No sync has run yet.</p>;
  }

  const warnings = rows.flatMap((r) => r.warnings);
  const errors = rows.flatMap((r) => r.errors);

  return (
    <div className="mt-4 rounded-card border border-border bg-surface p-4">
      <header className="flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 font-heading text-sm font-bold text-ink">
          <RefreshCw className="h-4 w-4 text-primary" aria-hidden />
          Last sync
        </h3>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {relativeTime(rows[0].run_at)} · {rows[0].trigger}
        </span>
      </header>

      <ul className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <li key={r.source} className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium text-ink">
              {r.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-danger" aria-hidden />
              )}
              {r.source}
            </span>
            <span className="text-xs text-muted">
              {r.fetched} fetched · {r.expired} expired
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-muted">
        {rows[0].inserted} added · {rows[0].updated} updated across all sources
      </p>

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-btn border border-accent/30 bg-accent-soft px-3 py-2">
          {warnings.map((w) => (
            <li key={w} className="text-xs text-ink">
              {w}
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1">
          {errors.map((e) => (
            <li key={e} className="text-xs text-danger">
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
