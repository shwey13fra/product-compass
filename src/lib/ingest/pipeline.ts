// Stage 8 — ingest orchestration. Pure helpers (dedupe, classifyExpiry) are
// unit-tested; runIngest does the Supabase I/O with the admin's forwarded
// client so writes pass the roles admin-write RLS.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawJob, IngestSummary, JobSource, SourceStat, ExistingRole } from "./types";
import { isPmTitle, normalizeJob } from "./normalize";
import { fetchAllSources } from "./sources";

const SOURCE_ORDER: Record<JobSource, number> = { greenhouse: 0, lever: 1, adzuna: 2 };

// Dedupe by (source:external_id), then cross-source by company|title|location.
// The richest JD wins; ties fall back to source rank (ATS over aggregators), so
// equal-length descriptions stay deterministic rather than input-order dependent.
export function dedupe(jobs: RawJob[]): RawJob[] {
  const sorted = [...jobs].sort((a, b) => {
    const byRichness = (b.jd_text?.length ?? 0) - (a.jd_text?.length ?? 0);
    if (byRichness !== 0) return byRichness;
    return SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
  });
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

// Ids to flip is_live=false: live rows absent from this pull, EXCLUDING every
// source in skipSources. A failed pull has an empty fresh set, so without the
// skip we would delist an entire source on a transient outage (the Stage 8 bug).
// Already-dead rows are left alone so the `expired` count stays honest.
export function classifyExpiry(
  existing: ExistingRole[],
  freshIds: string[],
  skipSources: JobSource[]
): string[] {
  const fresh = new Set(freshIds);
  const skip = new Set(skipSources);
  return existing
    .filter((r) => r.is_live && !skip.has(r.source) && !fresh.has(r.id))
    .map((r) => r.id);
}

// Decide which sources must NOT be expired this run, and why.
//   * ok === false      → the fetch failed; absence proves nothing.
//   * fetched === 0 but the source still has live rows → a 200 with an empty
//     list (board rename, API shape change) is likelier than a board genuinely
//     emptying. Prefer stale-and-visible over silent data loss.
export function computeSkipSources(
  bySource: Record<JobSource, SourceStat>,
  previouslyLive: Record<JobSource, number>
): { skip: JobSource[]; warnings: string[] } {
  const skip: JobSource[] = [];
  const warnings: string[] = [];
  for (const source of Object.keys(bySource) as JobSource[]) {
    const stat = bySource[source];
    const live = previouslyLive[source] ?? 0;
    if (!stat.ok) {
      skip.push(source);
      warnings.push(`${source}: fetch failed — expiry skipped (${live} live rows kept)`);
    } else if (stat.fetched === 0 && live > 0) {
      skip.push(source);
      warnings.push(`${source}: 0 jobs returned but ${live} live — expiry skipped, check the source`);
    }
  }
  return { skip, warnings };
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

  // 4) Upsert the fresh rows (RLS: admin JWT on `client`). Only count
  //    added/updated (and run the expire pass) if the write actually succeeded —
  //    otherwise the summary would report phantom rows.
  let added = 0;
  let updated = 0;
  let upsertOk = true;
  if (rows.length > 0) {
    const { error: upErr } = await client.from("roles").upsert(rows, { onConflict: "id" });
    if (upErr) {
      errors.push(`upsert: ${upErr.message}`);
      upsertOk = false;
    } else {
      added = freshIds.filter((id) => !existingSet.has(id)).length;
      updated = freshIds.length - added;
    }
  }

  // 5) Expire ingested rows missing from this pull. NEVER touches seed/referral
  //    rows — the .in("source", INGESTED_SOURCES) filter excludes source='seed'.
  //    Skip if the upsert failed (this pull didn't persist).
  const toExpire = upsertOk ? classifyExpiry(existingIngestedIds, freshIds) : [];
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
