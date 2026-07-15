# Stage 12 — Daily Cron Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Stage 8 ingest pipeline automatically once a day on a Vercel cron, without a service-role key, and fix the source-outage expiry bug that automation would otherwise make silent.

**Architecture:** A `GET /api/cron/ingest` route authenticates Vercel's cron via `CRON_SECRET`, signs in a dedicated Supabase **bot user**, and calls the *unchanged* `runIngest(client)` — so cron and the admin "Sync jobs now" button share one write path gated by one RLS rule (`is_admin() or is_ingest_bot()`). Expiry becomes per-source and is skipped for any source that failed or returned a suspicious zero. Every run writes one `sync_runs` row per source, surfaced in the admin view.

**Tech Stack:** Next.js 16 App Router · TypeScript · Supabase (anon key + RLS + auth JWT) · Vercel Cron · plain `node:assert` tests run with `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-07-15-stage12-cron-ingestion-design.md`

## Global Constraints

- **NEVER** use a Supabase `service_role` key. Anon key + RLS + forwarded JWTs only.
- **NEVER** introduce a `SECURITY DEFINER` function granted to `anon` that writes data unless the function itself verifies a secret argument. (Spec D1 — the anon key is public.)
- Secrets are **server env only** — never `NEXT_PUBLIC_*`. `.env.local` stays out of git; `.env.example` gets placeholders only.
- Analytics/PII rule: `props` carry **ids, enums, booleans, counts only**. Never company names, JD text, emails, or the bot's credentials.
- Design tokens only — never hardcode hex. Warm Clay tokens (`bg-surface`, `text-muted`, `text-danger`, `bg-accent-soft`, …).
- Handle every state: loading / empty / error / success.
- Tests are standalone scripts run with `npx tsx scripts/tests/<name>.test.ts`. There is **no** test runner and **no** `npm test` script. Use `node:assert/strict` and end with a `console.log("<name>: all assertions passed")`.
- Existing behaviour that must not regress: when two sources tie on JD length, **greenhouse beats lever beats adzuna** (`scripts/tests/pipeline.test.ts:11`).
- Every task ends with `npx tsc --noEmit` clean before commit.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/ingest/types.ts` | **Modify.** `SourceStat`, widen `IngestSummary.bySource`, add `warnings`, add `ExistingRole`. |
| `src/lib/ingest/pipeline.ts` | **Modify.** `dedupe` tiebreak; `classifyExpiry` per-source; new pure `computeSkipSources`; `runIngest` wiring. |
| `src/lib/ingest/sources.ts` | **Modify.** `fetchAllSources` returns real per-source health (`sourceOk`) instead of a flat error list. |
| `src/lib/ingest/syncRuns.ts` | **Create.** `writeSyncRun` / `getLatestSyncRun`. Isolated so pipeline stays free of logging concerns. |
| `src/lib/analytics.ts` | **Modify.** Add `trackServer` + `"ingest_run"` event name. |
| `src/app/api/cron/ingest/route.ts` | **Create.** Cron auth + bot sign-in + run + log. |
| `src/app/api/ingest/route.ts` | **Modify.** Log its run to `sync_runs` too (trigger `manual`). |
| `src/components/LastSyncCard.tsx` | **Create.** Admin last-run summary. Own file so `/admin` doesn't grow. |
| `src/app/admin/page.tsx` | **Modify.** Mount `LastSyncCard`. |
| `scripts/stage12-cron-ingestion.sql` | **Create.** `is_ingest_bot()`, widened `roles` policies, `sync_runs` + RLS. |
| `vercel.json` | **Create.** One daily cron entry. |
| `.env.example` | **Modify.** Three new placeholders. |
| `scripts/tests/pipeline.test.ts` | **Modify.** Extend for the new behaviour. |
| `scripts/tests/skipSources.test.ts` | **Create.** Circuit-breaker unit tests. |

---

### Task 1: Dedupe prefers the richer JD (with source tiebreak)

**Files:**
- Modify: `src/lib/ingest/pipeline.ts:10-28`
- Test: `scripts/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `RawJob` from `src/lib/ingest/types.ts` (unchanged).
- Produces: `dedupe(jobs: RawJob[]): RawJob[]` — same signature, new ordering rule.

**Why the tiebreak matters:** `Array.prototype.sort` is stable, so sorting *only* by
JD length would leave equal-length jobs in input order — making adzuna win when it
happens to be listed first. That silently regresses `pipeline.test.ts:11`. JD length
first, `SOURCE_ORDER` second.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tests/pipeline.test.ts` (before the final `console.log`):

```ts
// Richer JD wins across sources for the same (company, title, location).
const richer = dedupe([
  { ...base, source: "greenhouse", external_id: "g1", jd_text: "short" } as RawJob,
  { ...base, source: "adzuna", external_id: "a1", jd_text: "a much longer and richer job description" } as RawJob,
]);
assert.equal(richer.length, 1);
assert.equal(richer[0].source, "adzuna", "longer jd_text should win over source rank");

// Tie on JD length → fall back to source rank (greenhouse > lever > adzuna).
const tie = dedupe([
  { ...base, source: "adzuna", external_id: "a1", jd_text: "same" } as RawJob,
  { ...base, source: "greenhouse", external_id: "g1", jd_text: "same" } as RawJob,
]);
assert.equal(tie.length, 1);
assert.equal(tie[0].source, "greenhouse", "equal jd_text must fall back to SOURCE_ORDER");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/tests/pipeline.test.ts`
Expected: FAIL — `AssertionError: longer jd_text should win over source rank` (`'greenhouse' !== 'adzuna'`).

- [ ] **Step 3: Write minimal implementation**

Replace the sort in `src/lib/ingest/pipeline.ts` `dedupe`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/tests/pipeline.test.ts`
Expected: PASS — `pipeline: all assertions passed`. The pre-existing ATS-preference
assertion at line 11 must still pass (both JDs are `"x"` → tie → greenhouse).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/ingest/pipeline.ts scripts/tests/pipeline.test.ts
git commit -m "feat(stage12): dedupe prefers the richer JD, ties fall back to source rank"
```

---

### Task 2: Per-source expiry + the skip-sources circuit breaker

**Files:**
- Modify: `src/lib/ingest/types.ts:1-22`
- Modify: `src/lib/ingest/pipeline.ts:30-33`
- Test: `scripts/tests/pipeline.test.ts`, `scripts/tests/skipSources.test.ts` (create)

**Interfaces:**
- Produces:
  - `type SourceStat = { fetched: number; ok: boolean }`
  - `type ExistingRole = { id: string; source: JobSource; is_live: boolean }`
  - `classifyExpiry(existing: ExistingRole[], freshIds: string[], skipSources: JobSource[]): string[]`
  - `computeSkipSources(bySource: Record<JobSource, SourceStat>, previouslyLive: Record<JobSource, number>): { skip: JobSource[]; warnings: string[] }`
- Consumed by: Task 3 (`runIngest`).

**Note — signature change is intentional.** `classifyExpiry` moves from
`(string[], string[])` to `(ExistingRole[], string[], JobSource[])`. The old
call site in `runIngest` is updated in Task 3; the old assertion in
`pipeline.test.ts:26` is rewritten in Step 1 below. A global fresh-id set plus
`skipSources` is equivalent to per-source matching (ingested ids are unique per
source) and is simpler — the per-source part that actually matters is the skip.

- [ ] **Step 1: Write the failing tests**

In `scripts/tests/pipeline.test.ts`, **replace** the existing expiry assertion
(`const expired = classifyExpiry(["greenhouse:g1", "lever:l9"], ["greenhouse:g1"]);`
and its `assert.deepEqual`) with:

```ts
import type { ExistingRole } from "@/lib/ingest/types";

const existing: ExistingRole[] = [
  { id: "greenhouse:g1", source: "greenhouse", is_live: true },
  { id: "lever:l9", source: "lever", is_live: true },
  { id: "adzuna:a5", source: "adzuna", is_live: true },
];

// Baseline: ids absent from the fresh pull expire, when no source is skipped.
assert.deepEqual(
  classifyExpiry(existing, ["greenhouse:g1"], []).sort(),
  ["adzuna:a5", "lever:l9"]
);

// THE STAGE 8 BUG: adzuna failed this run → its rows must NOT expire.
assert.deepEqual(
  classifyExpiry(existing, ["greenhouse:g1"], ["adzuna"]),
  ["lever:l9"],
  "a skipped source must never be expired"
);

// Already-dead rows aren't re-expired (keeps the `expired` count honest).
const halfDead: ExistingRole[] = [
  { id: "lever:l9", source: "lever", is_live: false },
];
assert.deepEqual(classifyExpiry(halfDead, [], []), []);
```

Create `scripts/tests/skipSources.test.ts`:

```ts
import assert from "node:assert/strict";
import { computeSkipSources } from "@/lib/ingest/pipeline";
import type { JobSource, SourceStat } from "@/lib/ingest/types";

const stats = (o: Partial<Record<JobSource, SourceStat>>): Record<JobSource, SourceStat> => ({
  greenhouse: { fetched: 5, ok: true },
  lever: { fetched: 5, ok: true },
  adzuna: { fetched: 5, ok: true },
  ...o,
});
const live = (o: Partial<Record<JobSource, number>>): Record<JobSource, number> => ({
  greenhouse: 10,
  lever: 10,
  adzuna: 10,
  ...o,
});

// Healthy run → nothing skipped.
assert.deepEqual(computeSkipSources(stats({}), live({})).skip, []);

// A source that errored is skipped (the real Stage 8 bug).
const failed = computeSkipSources(stats({ adzuna: { fetched: 0, ok: false } }), live({}));
assert.deepEqual(failed.skip, ["adzuna"]);
assert.equal(failed.warnings.length, 1);
assert.ok(failed.warnings[0].includes("adzuna"));

// Circuit breaker: 200 OK but zero rows while rows are live → skip + warn.
const zero = computeSkipSources(stats({ adzuna: { fetched: 0, ok: true } }), live({}));
assert.deepEqual(zero.skip, ["adzuna"]);
assert.ok(zero.warnings[0].includes("0 jobs"));

// Circuit breaker does NOT fire for a genuinely new/empty source.
const fresh = computeSkipSources(stats({ lever: { fetched: 0, ok: true } }), live({ lever: 0 }));
assert.deepEqual(fresh.skip, []);
assert.deepEqual(fresh.warnings, []);

console.log("skipSources: all assertions passed");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx scripts/tests/skipSources.test.ts`
Expected: FAIL — `computeSkipSources` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ingest/types.ts`, add:

```ts
// Per-source health for one ingest run. `fetched` counts PM-filtered jobs
// BEFORE dedupe — it answers "did this source return anything?".
export type SourceStat = { fetched: number; ok: boolean };

// The subset of an existing `roles` row that expiry decisions need.
export type ExistingRole = { id: string; source: JobSource; is_live: boolean };
```

and replace `IngestSummary` with:

```ts
export type IngestSummary = {
  added: number;
  updated: number;
  expired: number;
  bySource: Record<JobSource, SourceStat>;
  errors: string[];
  warnings: string[];
};
```

In `src/lib/ingest/pipeline.ts`, replace `classifyExpiry` and add `computeSkipSources`:

```ts
import type { RawJob, IngestSummary, JobSource, SourceStat, ExistingRole } from "./types";

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx scripts/tests/skipSources.test.ts`
Expected: PASS — `skipSources: all assertions passed`.

`npx tsx scripts/tests/pipeline.test.ts` will still FAIL to typecheck at the
`runIngest` call site — that is expected and fixed in Task 3. Do not "fix" it here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest/types.ts src/lib/ingest/pipeline.ts scripts/tests/
git commit -m "feat(stage12): per-source expiry + skip-sources circuit breaker

Fixes a Stage 8 bug: classifyExpiry compared all ingested ids against the current
pull with no notion of source, so a best-effort source failure (fetchAllSources
returns {jobs: [], error} rather than throwing) delisted every role for that
source. Harmless when a human clicks Sync and reads the errors; silent under a
daily cron."
```

---

### Task 3: Real per-source health + `runIngest` wiring

**Files:**
- Modify: `src/lib/ingest/sources.ts:137-151`
- Modify: `src/lib/ingest/pipeline.ts:37-93`

**Interfaces:**
- Consumes: `computeSkipSources`, `classifyExpiry`, `ExistingRole`, `SourceStat` (Task 2).
- Produces: `fetchAllSources(): Promise<{ jobs: RawJob[]; errors: string[]; sourceOk: Record<JobSource, boolean> }>` · `runIngest(client: SupabaseClient): Promise<IngestSummary>` (same signature, richer summary).

**Why `sourceOk` and not error-string parsing:** `fetchAllSources` flattens N
greenhouse boards + M lever companies + adzuna into one `errors: string[]`, so
"did greenhouse fail?" is currently only answerable by substring-matching error
text. That is fragile. **A source is `ok` only if *every* fetch for it succeeded** —
if one of several greenhouse boards is down, we conservatively skip greenhouse
expiry (stale beats lost).

- [ ] **Step 1: Give `fetchAllSources` per-source health**

Replace `fetchAllSources` in `src/lib/ingest/sources.ts`:

```ts
// Fetch every configured source, collecting jobs, per-source errors, and
// per-source health. A source is ok ONLY if every fetch for it succeeded — one
// dead greenhouse board marks greenhouse not-ok, so expiry conservatively skips
// it rather than delisting that board's roles.
export async function fetchAllSources(): Promise<{
  jobs: RawJob[];
  errors: string[];
  sourceOk: Record<JobSource, boolean>;
}> {
  const tagged: { source: JobSource; result: FetchResult }[] = [
    ...(await Promise.all(
      GREENHOUSE_BOARDS.map(async (t) => ({ source: "greenhouse" as const, result: await fetchGreenhouse(t) }))
    )),
    ...(await Promise.all(
      LEVER_COMPANIES.map(async (c) => ({ source: "lever" as const, result: await fetchLever(c) }))
    )),
    { source: "adzuna" as const, result: await fetchAdzuna() },
  ];

  const jobs: RawJob[] = [];
  const errors: string[] = [];
  const sourceOk: Record<JobSource, boolean> = { greenhouse: true, lever: true, adzuna: true };
  for (const { source, result } of tagged) {
    jobs.push(...result.jobs);
    if (result.error) {
      errors.push(result.error);
      sourceOk[source] = false;
    }
  }
  return { jobs, errors, sourceOk };
}
```

Add `JobSource` to the type import at the top of the file:

```ts
import type { RawJob, JobSource } from "./types";
```

- [ ] **Step 2: Verify the existing sources test still passes**

Run: `npx tsx scripts/tests/sources.test.ts`
Expected: PASS — the pure parsers are untouched.

- [ ] **Step 3: Rewire `runIngest`**

Replace the body of `runIngest` in `src/lib/ingest/pipeline.ts`:

```ts
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

  // 4) Upsert. Only count/expire if the write landed — otherwise the summary
  //    would report phantom rows (Stage 8 rule, preserved).
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

  // 5) Expire — per source, never for a source we can't trust this run.
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
```

- [ ] **Step 4: Typecheck and run every test**

```bash
npx tsc --noEmit
npx tsx scripts/tests/pipeline.test.ts
npx tsx scripts/tests/skipSources.test.ts
npx tsx scripts/tests/normalize.test.ts
npx tsx scripts/tests/sources.test.ts
npx tsx scripts/tests/realPmScore.test.ts
```
Expected: tsc clean; all five print `all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest/
git commit -m "feat(stage12): real per-source health from fetchAllSources; wire runIngest"
```

---

### Task 4: SQL migration — `is_ingest_bot()`, widened `roles` policies, `sync_runs`

**Files:**
- Create: `scripts/stage12-cron-ingestion.sql`
- Modify: `.env.example`

**Interfaces:**
- Produces: `public.is_ingest_bot()` · `public.sync_runs` table.
- Consumed by: Tasks 5, 6, 7.

**Policy names and `is_admin()` shape are VERIFIED against
`scripts/stage7-auth-referrals.sql:93-103` — do not guess, do not rename:**

```sql
-- stage7:93-99, the exact policies this task widens
create policy "roles admin insert" on public.roles
  for insert to authenticated with check (public.is_admin());
create policy "roles admin update" on public.roles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- stage7:101-103 "roles admin delete" is LEFT ALONE (bot never deletes).
```

`is_admin()` (stage7:20-35) is `language sql / stable / security definer /
set search_path = public`, comparing `lower(auth.jwt() ->> 'email')`.
`is_ingest_bot()` below mirrors that shape exactly.

- [ ] **Step 1: Write the migration**

Create `scripts/stage12-cron-ingestion.sql`:

```sql
-- Product Compass — Stage 12: daily cron ingestion.
-- Run ONCE in the Supabase SQL editor (service role → bypasses RLS). Idempotent.
--
-- SECURITY RULE (unchanged): anon key only, NEVER service-role. The cron writes
-- as a dedicated Supabase auth BOT USER whose JWT is forwarded to the existing
-- pipeline — NOT via a SECURITY DEFINER function granted to anon, which would be
-- publicly callable (the anon key ships in the browser bundle).
--
-- ⚠️ Additive and backward-compatible: it only ADDS a predicate, WIDENS the roles
-- write policies, and creates a new table. Safe to run before deploying the code.
-- Stage 11 lesson still applies: the stage is not done until migration AND deploy
-- are both live and verified against the PRODUCTION url.
--
-- PREREQ: create the bot user first (Supabase → Authentication → Users → Add user,
-- "Auto Confirm User" ON), then put its email below AND in INGEST_BOT_EMAIL.

-- ============================================================================
-- 1) is_ingest_bot() — least privilege. Mirrors is_admin()'s shape but grants
--    ONLY roles writes. Deliberately NOT folded into is_admin(): that would make
--    a leaked bot password full admin at the data layer (read referral
--    applications, override statuses), since ADMIN_EMAILS drives only the UI.
-- ============================================================================
create or replace function public.is_ingest_bot()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') = lower('BOT_EMAIL_HERE');
$$;

grant execute on function public.is_ingest_bot() to authenticated;

-- ============================================================================
-- 2) roles — widen the admin-only write policies to admin-OR-bot.
--    Replace the policy names below with the REAL ones from stage7 if they differ.
-- ============================================================================
drop policy if exists "roles admin insert" on public.roles;
create policy "roles admin insert" on public.roles
  for insert to authenticated
  with check (public.is_admin() or public.is_ingest_bot());

drop policy if exists "roles admin update" on public.roles;
create policy "roles admin update" on public.roles
  for update to authenticated
  using (public.is_admin() or public.is_ingest_bot())
  with check (public.is_admin() or public.is_ingest_bot());

-- DELETE stays admin-only: the bot never deletes (expiry flips is_live=false).

-- ============================================================================
-- 3) sync_runs — one row per source per run. Admin-readable, never client-readable
--    (it names companies and failure modes). Anon has NO policy → deny-all.
-- ============================================================================
create table if not exists public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null,
  run_at      timestamptz not null default now(),
  trigger     text not null,                       -- 'cron' | 'manual'
  source      text not null,                       -- 'greenhouse' | 'lever' | 'adzuna'
  fetched     int  not null default 0,
  inserted    int  not null default 0,
  updated     int  not null default 0,
  expired     int  not null default 0,
  ok          boolean not null default true,
  errors      text[] not null default '{}',
  warnings    text[] not null default '{}'
);

create index if not exists sync_runs_run_at_idx on public.sync_runs (run_at desc);

alter table public.sync_runs enable row level security;

drop policy if exists "sync_runs write admin or bot" on public.sync_runs;
create policy "sync_runs write admin or bot" on public.sync_runs
  for insert to authenticated
  with check (public.is_admin() or public.is_ingest_bot());

drop policy if exists "sync_runs read admin" on public.sync_runs;
create policy "sync_runs read admin" on public.sync_runs
  for select to authenticated
  using (public.is_admin());

-- ============================================================================
-- Done. Env (server-side, Vercel): CRON_SECRET, INGEST_BOT_EMAIL,
-- INGEST_BOT_PASSWORD. // TODO(v2): retention/cleanup for sync_runs.
-- ============================================================================
```

- [ ] **Step 2: Add env placeholders**

Append to `.env.example`:

```
# Stage 12 — daily cron ingestion (server-side only, NEVER NEXT_PUBLIC_*).
# CRON_SECRET: Vercel sends it as `Authorization: Bearer <secret>` on cron calls.
# The route fails CLOSED if it is unset, so the endpoint can never be left open.
CRON_SECRET=your-long-random-cron-secret
# A dedicated Supabase auth user that may ONLY write `roles` (see is_ingest_bot()
# in scripts/stage12-cron-ingestion.sql). Not an admin.
INGEST_BOT_EMAIL=ingest-bot@example.com
INGEST_BOT_PASSWORD=your-ingest-bot-password
```

- [ ] **Step 3: Verify no secret leaked into git**

```bash
grep -rniE "sk-ant-|service_role" scripts/stage12-cron-ingestion.sql .env.example
git check-ignore -v .env.local
```
Expected: no matches; `.env.local` reported as ignored.

- [ ] **Step 4: Commit**

```bash
git add scripts/stage12-cron-ingestion.sql .env.example
git commit -m "feat(stage12): migration — is_ingest_bot(), admin-or-bot roles writes, sync_runs"
```

---

### Task 5: `syncRuns.ts` + `trackServer`

**Files:**
- Create: `src/lib/ingest/syncRuns.ts`
- Modify: `src/lib/analytics.ts:19-29`

**Interfaces:**
- Consumes: `IngestSummary`, `JobSource` (Task 2).
- Produces:
  - `writeSyncRun(client: SupabaseClient, trigger: "cron" | "manual", summary: IngestSummary): Promise<string>` → the `run_id`
  - `getLatestSyncRun(client: SupabaseClient): Promise<SyncRunRow[]>`
  - `type SyncRunRow`
  - `trackServer(name: EventName, props?: Record<string, unknown>): Promise<void>`

- [ ] **Step 1: Create `src/lib/ingest/syncRuns.ts`**

```ts
// Stage 12 — durable log of each ingest run, one row per source. Read by the
// admin view. Logging must NEVER fail the ingest it is reporting on.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestSummary, JobSource } from "./types";

export type SyncRunRow = {
  run_id: string;
  run_at: string;
  trigger: "cron" | "manual";
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
// which every fetcher and computeSkipSources already emits (see sources.ts).
function forSource(messages: string[], source: JobSource): string[] {
  return messages.filter((m) => m.toLowerCase().startsWith(`${source}:`));
}

// Writes one row per source. `added`/`updated`/`expired` are run-level totals in
// IngestSummary, so they are recorded on every row of the run rather than being
// invented per source — the run_id groups them.
export async function writeSyncRun(
  client: SupabaseClient,
  trigger: "cron" | "manual",
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

// Newest run's rows (up to one per source). Requires an admin JWT — RLS denies
// select to everyone else.
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
```

- [ ] **Step 2: Add `trackServer` to `src/lib/analytics.ts`**

Add `"ingest_run"` to the `EventName` union:

```ts
  | "onboarding_completed"
  | "sign_in"
  | "ingest_run"; // { trigger, added, updated, expired, sources_ok, sources_failed }
```

Append to the file:

```ts
// Server-side sibling of track(). track() no-ops when `window` is undefined, so
// calling it from a route handler or cron would silently record NOTHING. Mirrors
// logError: direct insert, never throws, no browser context.
// PII rule unchanged: counts/enums/booleans only — never company names or JD text.
export async function trackServer(
  name: EventName,
  props: Record<string, unknown> = {}
): Promise<void> {
  try {
    await supabase.from("events").insert({ uid: null, user_id: null, name, props });
  } catch {
    // Instrumentation must never break the request it reports on.
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ingest/syncRuns.ts src/lib/analytics.ts
git commit -m "feat(stage12): sync_runs logging + trackServer (track() no-ops server-side)"
```

---

### Task 6: The cron route + `vercel.json`

**Files:**
- Create: `src/app/api/cron/ingest/route.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `runIngest` (Task 3), `writeSyncRun` (Task 5), `trackServer` (Task 5), `logError`.
- Produces: `GET /api/cron/ingest`.

- [ ] **Step 1: Create the route**

```ts
// Stage 12 — daily cron ingestion. GET (Vercel cron sends GET, not POST).
//
// AUTH: Vercel automatically attaches `Authorization: Bearer $CRON_SECRET` when
// CRON_SECRET is set in the project env. We fail CLOSED when it is unset — a
// missing env var must never leave this endpoint open.
//
// WRITES: signs in a dedicated bot user and forwards ITS JWT to the SHARED
// runIngest() pipeline, so RLS (is_admin() or is_ingest_bot()) stays the single
// write gate. NO service_role key. NO publicly-callable definer RPC.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runIngest } from "@/lib/ingest/pipeline";
import { writeSyncRun } from "@/lib/ingest/syncRuns";
import { trackServer } from "@/lib/analytics";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    await logError("api/cron/ingest", "CRON_SECRET not configured (failing closed)", {});
    return NextResponse.json({ error: "Not configured." }, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.INGEST_BOT_EMAIL;
  const password = process.env.INGEST_BOT_PASSWORD;
  if (!url || !anon || !email || !password) {
    await logError("api/cron/ingest", "missing supabase or bot env", {});
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  // Per-request client carrying the bot's JWT → RLS evaluates is_ingest_bot().
  const bot = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await bot.auth.signInWithPassword({ email, password });
  if (signInErr) {
    // Never echo the password or the raw auth error.
    await logError("api/cron/ingest", "bot sign-in failed", {});
    return NextResponse.json({ error: "Ingest auth failed." }, { status: 500 });
  }

  try {
    const summary = await runIngest(bot);
    const run_id = await writeSyncRun(bot, "cron", summary);
    await trackServer("ingest_run", {
      trigger: "cron",
      added: summary.added,
      updated: summary.updated,
      expired: summary.expired,
      sources_ok: Object.values(summary.bySource).filter((s) => s.ok).length,
      sources_failed: Object.values(summary.bySource).filter((s) => !s.ok).length,
    });
    return NextResponse.json({ run_id, ...summary });
  } catch {
    await logError("api/cron/ingest", "ingest threw", {});
    return NextResponse.json({ error: "Ingest failed." }, { status: 500 });
  } finally {
    await bot.auth.signOut();
  }
}
```

- [ ] **Step 2: Create `vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/ingest",
      "schedule": "0 3 * * *"
    }
  ]
}
```

- [ ] **Step 3: Typecheck + build**

```bash
npx tsc --noEmit
npx next build
```
Expected: clean; the route table lists `ƒ /api/cron/ingest`.

- [ ] **Step 4: Prove the auth gate locally**

```bash
npm run dev    # separate terminal
curl.exe -s -o /dev/null -w "no header:    HTTP %{http_code}\n" http://localhost:3000/api/cron/ingest
curl.exe -s -o /dev/null -w "wrong secret: HTTP %{http_code}\n" -H "Authorization: Bearer wrong" http://localhost:3000/api/cron/ingest
```
Expected: **401** for both. (A correct-secret run needs the migration + bot user —
that is the Task 8 live verification, not this step.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/ingest/route.ts vercel.json
git commit -m "feat(stage12): daily cron route (GET, CRON_SECRET fail-closed, bot JWT) + vercel.json"
```

---

### Task 7: Log manual syncs + the admin last-run card

**Files:**
- Modify: `src/app/api/ingest/route.ts:39-46`
- Create: `src/components/LastSyncCard.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `writeSyncRun`, `getLatestSyncRun`, `SyncRunRow` (Task 5).

- [ ] **Step 1: Log the manual run**

In `src/app/api/ingest/route.ts`, replace the `try` block:

```ts
  try {
    const summary = await runIngest(client);
    const run_id = await writeSyncRun(client, "manual", summary);
    await trackServer("ingest_run", {
      trigger: "manual",
      added: summary.added,
      updated: summary.updated,
      expired: summary.expired,
      sources_ok: Object.values(summary.bySource).filter((s) => s.ok).length,
      sources_failed: Object.values(summary.bySource).filter((s) => !s.ok).length,
    });
    return NextResponse.json({ run_id, ...summary });
  } catch {
    // Never echo keys or raw upstream bodies.
    return NextResponse.json({ error: "Ingest failed. Check server logs." }, { status: 500 });
  }
```

and add the imports:

```ts
import { writeSyncRun } from "@/lib/ingest/syncRuns";
import { trackServer } from "@/lib/analytics";
```

Delete the now-done `// TODO(v2): Vercel Cron for automatic daily sync` comment at
the end of the file.

- [ ] **Step 2: Create `src/components/LastSyncCard.tsx`**

```tsx
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
// sync_runs with the admin's session — RLS denies everyone else.
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
      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-danger">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        {error}
      </p>
    );
  }
  if (rows === null) {
    return <div className="h-24 animate-pulse rounded-card bg-surface-alt" aria-hidden />;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted">No sync has run yet.</p>;
  }

  const warnings = rows.flatMap((r) => r.warnings);
  const errors = rows.flatMap((r) => r.errors);

  return (
    <div className="rounded-card border border-border bg-surface p-4">
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
```

- [ ] **Step 3: Mount it in `/admin`**

Read `src/app/admin/page.tsx`, find the existing "Sync jobs now" panel, and render
`<LastSyncCard />` directly beneath it. Add the import:

```ts
import { LastSyncCard } from "@/components/LastSyncCard";
```

- [ ] **Step 4: Typecheck + build**

```bash
npx tsc --noEmit
npx next build
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ingest/route.ts src/components/LastSyncCard.tsx src/app/admin/page.tsx
git commit -m "feat(stage12): log manual syncs to sync_runs + admin last-run card"
```

---

### Task 8: Live verification + records

**Files:**
- Create: `docs/VERIFICATION_STAGE12.md`
- Modify: `knowledge/SESSION_JOURNAL.md`, `knowledge/DECISIONS.md`, `CLAUDE.md`

**Prereqs the USER must do first** (the code cannot work without them):
1. Supabase → Authentication → Users → **Add user**, Auto Confirm ON. Note the email.
2. Put that email into `BOT_EMAIL_HERE` in `scripts/stage12-cron-ingestion.sql`, run it.
3. Set `CRON_SECRET`, `INGEST_BOT_EMAIL`, `INGEST_BOT_PASSWORD` in **Vercel** (and
   `.env.local` for local testing).

- [ ] **Step 1: Verify the auth gate on production**

```bash
curl.exe -s -o /dev/null -w "no header:    HTTP %{http_code}\n" https://product-compass-lilac.vercel.app/api/cron/ingest
curl.exe -s -o /dev/null -w "wrong secret: HTTP %{http_code}\n" -H "Authorization: Bearer wrong" https://product-compass-lilac.vercel.app/api/cron/ingest
```
Expected: **401** both.

- [ ] **Step 2: Verify a real run**

```bash
curl.exe -s -w "\nHTTP %{http_code}\n" -H "Authorization: Bearer $env:CRON_SECRET" https://product-compass-lilac.vercel.app/api/cron/ingest
```
Expected: **200** with `run_id`, `added`/`updated`/`expired`, `bySource`, `warnings`.

- [ ] **Step 3: Prove sync_runs isolation (Stage 11's three-leg method)**

```bash
# CONTROL — the anon key works at all
curl.exe -s "$url/rest/v1/roles?select=id&limit=1" -H "apikey: $anon" -H "Authorization: Bearer $anon"
# ATTACK — sync_runs must be invisible to anon
curl.exe -s "$url/rest/v1/sync_runs?select=*" -H "apikey: $anon" -H "Authorization: Bearer $anon"
```
Expected: control returns a row; attack returns `[]`. The control is what makes the
`[]` meaningful — without it, `[]` could just mean "empty table".

- [ ] **Step 4: Verify the admin card + the bug fix**

- `/admin` shows the Last sync card with per-source counts.
- In the SQL editor: `select source, fetched, expired, ok, warnings from sync_runs order by run_at desc limit 3;`
- **Bug-fix proof:** temporarily unset `ADZUNA_APP_ID` in `.env.local`, run the
  route locally with the correct secret, and confirm `adzuna` shows `ok = false`,
  a warning, and **`expired = 0`** — i.e. the outage did *not* delist Adzuna's
  roles. Restore the key afterwards.

- [ ] **Step 5: Write the records and commit**

Create `docs/VERIFICATION_STAGE12.md` following `docs/VERIFICATION_STAGE11.md`'s
shape (setup gotchas → per-claim tables with **Expected** and **Actual** columns →
bugs found → parked). Update `SESSION_JOURNAL.md` (CURRENT STATE + a session entry),
`DECISIONS.md` (D1–D7 one-liners from the spec), and `CLAUDE.md`'s AI/Data/Security
lines for the new env vars and the bot identity.

```bash
git add docs/ knowledge/ CLAUDE.md
git commit -m "docs(stage12): verification record + journal/decisions"
git push origin main
```

---

## Self-Review

**Spec coverage:** §4 architecture → Tasks 3, 6, 7 · §5.1 cron route → Task 6 ·
§5.2 pipeline → Tasks 1–3 · §5.2b types → Task 2 · §5.3 syncRuns → Task 5 ·
§5.4 trackServer → Task 5 · §5.5 admin card → Task 7 · §5.6 migration → Task 4 ·
§5.7 vercel.json → Task 6 · §6 data model → Task 4 · §7 security → Tasks 4, 6 ·
§8 error handling → Tasks 3, 5, 6 · §9 testing → Tasks 1, 2, 6, 8 · §10 env → Tasks 4, 8.
No gaps.

**Deviations from the spec, and why:**
- Spec §5.2 proposed `classifyExpiry(existingBySource, freshBySource, skipSources)`.
  The plan uses `(existing: ExistingRole[], freshIds: string[], skipSources)` — a
  global fresh-id set is equivalent (ingested ids are unique per source) and
  simpler; the per-source part that matters is the skip.
- Spec did not mention `sourceOk`. Task 3 adds it: `fetchAllSources` flattens
  per-board errors into one string list, so per-source health was otherwise only
  derivable by substring-matching error text.
- Spec §5.2's tiebreak omitted the `SOURCE_ORDER` fallback. Added — without it,
  stable-sort would let input order decide ties and regress `pipeline.test.ts:11`.

**Type consistency:** `SourceStat`/`ExistingRole`/`IngestSummary` defined once in
Task 2, consumed with identical names in Tasks 3, 5, 6, 7. `writeSyncRun` and
`getLatestSyncRun` signatures match between Task 5 and Task 7. `trackServer` props
identical in Tasks 6 and 7.

**Verified at plan time (was a guess, now checked):** the `roles` policy names
`"roles admin insert"` / `"roles admin update"` and the `is_admin()` function shape
are confirmed against `scripts/stage7-auth-referrals.sql:93-103` and quoted in
Task 4. Had they been wrong, `drop policy if exists` would silently no-op, leave
the admin-only policies in place, and the cron would fail with an RLS error at 3am
rather than anything louder.

**The one remaining human input:** `BOT_EMAIL_HERE` in the migration must be
replaced with the real bot email before the SQL is run (Task 8 prereq 1-2). It
cannot be filled in at plan time because the user creates the auth user manually.
</content>
</invoke>
