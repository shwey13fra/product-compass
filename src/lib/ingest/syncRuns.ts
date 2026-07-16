// Stage 12 — durable log of each ingest run, one row per source, grouped by
// run_id. Read by the admin view (RLS: admin-only select). Logging must NEVER
// fail the ingest it is reporting on.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestSummary, JobSource } from "./types";

export type SyncTrigger = "cron" | "manual";

export type SyncRunRow = {
  run_id: string;
  run_at: string;
  trigger: SyncTrigger;
  source: JobSource;
  fetched: number;
  inserted: number;
  updated: number;
  expired: number;
  ok: boolean;
  errors: string[];
  warnings: string[];
};

const SOURCES: JobSource[] = ["greenhouse", "lever", "adzuna"];

// Attribute a flat error/warning string to a source by its "<source>: ..." prefix,
// which every fetcher (sources.ts) and computeSkipSources already emits.
function forSource(messages: string[], source: JobSource): string[] {
  return messages.filter((m) => m.toLowerCase().startsWith(`${source}:`));
}

// Writes one row per source. added/updated/expired are run-level totals in
// IngestSummary, so they're recorded on every row of the run rather than being
// invented per source — run_id groups them.
export async function writeSyncRun(
  client: SupabaseClient,
  trigger: SyncTrigger,
  summary: IngestSummary
): Promise<string> {
  const run_id = crypto.randomUUID();
  try {
    const rows = SOURCES.map((source) => ({
      run_id,
      trigger,
      source,
      fetched: summary.bySource[source]?.fetched ?? 0,
      inserted: summary.added,
      updated: summary.updated,
      expired: summary.expired,
      ok: summary.bySource[source]?.ok ?? true,
      errors: forSource(summary.errors, source),
      warnings: forSource(summary.warnings, source),
    }));
    await client.from("sync_runs").insert(rows);
  } catch {
    // Swallow: a logging failure must never fail the ingest.
  }
  return run_id;
}

// The newest run's rows (up to one per source). Requires an admin JWT — RLS
// denies select to everyone else, and returns [] rather than throwing.
export async function getLatestSyncRun(client: SupabaseClient): Promise<SyncRunRow[]> {
  const { data: latest, error } = await client
    .from("sync_runs")
    .select("run_id")
    .order("run_at", { ascending: false })
    .limit(1);
  if (error || !latest || latest.length === 0) return [];

  const { data, error: rowsErr } = await client
    .from("sync_runs")
    .select("*")
    .eq("run_id", latest[0].run_id);
  if (rowsErr || !data) return [];
  return data as SyncRunRow[];
}
