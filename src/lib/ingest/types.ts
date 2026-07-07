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

export type IngestSummary = {
  added: number;
  updated: number;
  expired: number;
  bySource: Record<JobSource, number>;
  errors: string[];
};
