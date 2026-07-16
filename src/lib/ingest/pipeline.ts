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
  // 1) Fetch + filter to PM titles. Count per source BEFORE dedupe: `fetched`
  //    answers "did this source return anything?", which is what the circuit
  //    breaker needs — a dedupe drop is not a source failure.
  const { jobs: rawJobs, errors, sourceOk } = await fetchAllSources();
  const pmJobs = rawJobs.filter((j) => j.title && isPmTitle(j.title) && j.apply_url);

  const bySource: Record<JobSource, SourceStat> = {
    greenhouse: { fetched: 0, ok: sourceOk.greenhouse },
    lever: { fetched: 0, ok: sourceOk.lever },
    adzuna: { fetched: 0, ok: sourceOk.adzuna },
  };
  for (const j of pmJobs) bySource[j.source].fetched += 1;

  // 2) Dedupe + normalize to Role rows.
  const now = new Date();
  const rows = dedupe(pmJobs).map((j) => normalizeJob(j, now));
  const freshIds = rows.map((r) => r.id);

  // 3) Existing ingested rows. `source` drives per-source expiry; `is_live`
  //    feeds the circuit breaker and stops us re-expiring dead rows.
  const { data: existingRows, error: exErr } = await client
    .from("roles")
    .select("id, source, is_live")
    .in("source", INGESTED_SOURCES);
  if (exErr) errors.push(`read existing: ${exErr.message}`);
  const existing: ExistingRole[] = (existingRows ?? []) as ExistingRole[];
  const existingSet = new Set(existing.map((r) => r.id));

  const previouslyLive: Record<JobSource, number> = { greenhouse: 0, lever: 0, adzuna: 0 };
  for (const r of existing) if (r.is_live) previouslyLive[r.source] += 1;

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

  // 5) Expire ingested rows missing from this pull — per source, and NEVER for a
  //    source we can't trust this run (failed fetch, or a suspicious zero). NEVER
  //    touches seed/referral rows: the .in("source", INGESTED_SOURCES) filter
  //    above excludes source='seed'. Skip entirely if the upsert failed (this
  //    pull didn't persist).
  const { skip, warnings } = computeSkipSources(bySource, previouslyLive);
  const toExpire = upsertOk ? classifyExpiry(existing, freshIds, skip) : [];
  let expired = 0;
  if (toExpire.length > 0) {
    const { error: expErr } = await client
      .from("roles")
      .update({ is_live: false, freshness_checked_at: now.toISOString() })
      .in("id", toExpire);
    if (expErr) errors.push(`expire: ${expErr.message}`);
    else expired = toExpire.length;
  }

  return { added, updated, expired, bySource, errors, warnings };
}
