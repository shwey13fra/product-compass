// Stage 8 — shared ingestion types.

export type JobSource = "greenhouse" | "lever" | "adzuna";

// A job as returned by a source, already flattened to what we need.
export type RawJob = {
  source: JobSource;
  external_id: string;
  title: string;
  company: string;
  location: string | null;
  jd_text: string;
  apply_url: string;
};

// Per-source health for one ingest run. `fetched` counts PM-filtered jobs
// BEFORE dedupe — it answers "did this source return anything?".
export type SourceStat = { fetched: number; ok: boolean };

// The subset of an existing `roles` row that expiry decisions need.
export type ExistingRole = { id: string; source: JobSource; is_live: boolean };

export type IngestSummary = {
  added: number;
  updated: number;
  expired: number;
  bySource: Record<JobSource, SourceStat>;
  errors: string[];
  warnings: string[];
};
