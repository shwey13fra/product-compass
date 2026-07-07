// Stage 8 — ingest orchestration. Pure helpers (dedupe, classifyExpiry) are
// unit-tested; runIngest does the Supabase I/O with the admin's forwarded
// client so writes pass the roles admin-write RLS.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawJob, IngestSummary, JobSource } from "./types";
import { isPmTitle, normalizeJob } from "./normalize";
import { fetchAllSources } from "./sources";

const SOURCE_ORDER: Record<JobSource, number> = { greenhouse: 0, lever: 1, adzuna: 2 };

// Dedupe by (source:external_id), then cross-source by company|title|location.
// ATS sources (greenhouse, lever) win over Adzuna when the same job appears twice.
export function dedupe(jobs: RawJob[]): RawJob[] {
  const sorted = [...jobs].sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]);
  const seenId = new Set<string>();
  const seenKey = new Set<string>();
  const out: RawJob[] = [];
  for (const j of sorted) {
    const id = `${j.source}:${j.external_id}`;
    const key = `${j.company}|${j.title}|${j.location ?? ""}`.toLowerCase();
    if (seenId.has(id) || seenKey.has(key)) continue;
    seenId.add(id);
    seenKey.add(key);
    out.push(j);
  }
  return out;
}

export function classifyExpiry(existingIngestedIds: string[], freshIds: string[]): string[] {
  const fresh = new Set(freshIds);
  return existingIngestedIds.filter((id) => !fresh.has(id));
}

const INGESTED_SOURCES: JobSource[] = ["greenhouse", "lever", "adzuna"];

export async function runIngest(client: SupabaseClient): Promise<IngestSummary> {
  const bySource: Record<JobSource, number> = { greenhouse: 0, lever: 0, adzuna: 0 };

  // 1) Fetch + filter to PM titles + dedupe.
  const { jobs: rawJobs, errors } = await fetchAllSources();
  const pmJobs = dedupe(rawJobs.filter((j) => j.title && isPmTitle(j.title) && j.apply_url));

  // 2) Normalize to Role rows.
  const now = new Date();
  const rows = pmJobs.map((j) => {
    bySource[j.source] += 1;
    return normalizeJob(j, now);
  });
  const freshIds = rows.map((r) => r.id);

  // 3) Figure out which ingested ids already exist (added vs updated).
  const { data: existingRows, error: exErr } = await client
    .from("roles")
    .select("id")
    .in("source", INGESTED_SOURCES);
  if (exErr) errors.push(`read existing: ${exErr.message}`);
  const existingIngestedIds = (existingRows ?? []).map((r: { id: string }) => r.id);
  const existingSet = new Set(existingIngestedIds);
  const added = freshIds.filter((id) => !existingSet.has(id)).length;
  const updated = freshIds.length - added;

  // 4) Upsert the fresh rows (RLS: admin JWT on `client`).
  if (rows.length > 0) {
    const { error: upErr } = await client.from("roles").upsert(rows, { onConflict: "id" });
    if (upErr) errors.push(`upsert: ${upErr.message}`);
  }

  // 5) Expire ingested rows missing from this pull. NEVER touches seed/referral
  //    rows — the .in("source", INGESTED_SOURCES) filter excludes source='seed'.
  const toExpire = classifyExpiry(existingIngestedIds, freshIds);
  let expired = 0;
  if (toExpire.length > 0) {
    const { error: expErr } = await client
      .from("roles")
      .update({ is_live: false, freshness_checked_at: now.toISOString() })
      .in("id", toExpire);
    if (expErr) errors.push(`expire: ${expErr.message}`);
    else expired = toExpire.length;
  }

  return { added, updated, expired, bySource, errors };
}
