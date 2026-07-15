# Stage 12 — Daily cron ingestion (design)

**Date:** 2026-07-15 · **Status:** approved, pending implementation plan
**Depends on:** Stage 8 (ingest pipeline), Stage 10 (analytics), Stage 11 (RLS patterns)

---

## 1. What this stage is

Stage 8 already built the ingestion pipeline and an admin **"Sync jobs now"** button.
Stage 12 **automates** it on a daily Vercel cron — and fixes the two things that
automation breaks:

1. **Silent expiry.** A best-effort source failure currently delists that source's
   roles. A human clicking Sync sees the error; a 3am cron doesn't.
2. **Invisible failures.** With no human in the loop, a run needs a durable log
   and an admin-visible summary, or nobody learns a source has been dead for a week.

**Non-goals (explicit):** fuzzy cross-source matching, a `merged_sources` column,
more than one run per day, a service-role key, any new publicly-callable write RPC.

---

## 2. Decisions

| # | Decision | Rationale | Rejected alternative |
|---|----------|-----------|----------------------|
| D1 | Cron authenticates via a **dedicated Supabase auth bot user** whose JWT is forwarded to the existing pipeline | `runIngest(client)` already takes a `SupabaseClient`, so cron and the admin button share **one** write path. Zero new attack surface. | **A `SECURITY DEFINER ingest_upsert_roles` granted to `anon`** — the anon key is public (it ships in the browser bundle), so the RPC would be **callable by anyone**, and `SECURITY DEFINER` bypasses the admin-write RLS by design. The route's `CRON_SECRET` check is no defence: an attacker POSTs straight to `/rest/v1/rpc/...` and never touches Next.js. Proven this session — a terminal `curl` with only the anon key successfully called `rpc/get_applications`. If this route is ever revisited, the secret **must** be an argument the function itself verifies (as Stage 11's uid-bearer RPCs do). |
| D2 | Bot gets its **own** `is_ingest_bot()` RLS predicate, **not** membership in `is_admin()` | Least privilege: the bot may write `roles` and nothing else. | **Adding the bot to `ADMIN_EMAILS`/`is_admin()`.** `ADMIN_EMAILS` drives the **UI only** (`config.ts:5-7`); RLS is gated by `is_admin()`. So an `is_admin()` bot with a leaked password = full admin **at the data layer** (read `referral_applications`, override statuses) via the REST API, with the UI irrelevant. Excluding it from `ADMIN_EMAILS` would be cosmetic protection. |
| D3 | Expiry is **per-source**, and **skipped entirely for any source that errored** this run | Fixes a real Stage 8 bug (§3). | Per-source scoping **alone** — insufficient: a failed pull has an empty fresh set, so its rows still expire. |
| D4 | **Circuit breaker** on zero-rows: a source returning 0 while it has >0 live roles skips expiry and raises a warning | A 200 + empty array (board rename, API shape change) is far likelier than a board genuinely emptying. Failure mode becomes **stale + visible** instead of **silent data loss**. | **Trusting the data and expiring.** Simpler, but one bad upstream response delists a whole source with nothing surfaced. |
| D5 | Dedupe keeps **exact** `(company, title, location)` matching; only the tiebreak changes to **richer JD** | Directly encodes intent, ~3 lines. | **Fuzzy similarity.** *"Product Manager, Payments"* vs *"Product Manager, Platform"* at one company score high and are different jobs. A false merge **silently hides a real role**; a missed merge shows a duplicate. Costs are asymmetric — a duplicate is cosmetic, a hidden job breaks the product's core promise. |
| D6 | Add `trackServer()` rather than calling `track()` from the cron | `track()` returns early when `typeof window === "undefined"` (`analytics.ts:36`) — calling it from a cron is a **silent no-op**, shipping instrumentation that never fires. `logError` works server-side precisely because it lacks that guard. | Calling `track()` and assuming it works. |
| D7 | `sync_runs` stores **one row per source per run**, sharing a `run_id` | Makes per-source health ("Adzuna failed 3 days running") a trivial query. | One row per run with `by_source jsonb` — needs JSON digging for the question we most want to ask. |

---

## 3. The Stage 8 expiry bug (why D3/D4 exist)

`fetchAllSources` is deliberately best-effort — a failing source returns
`{ jobs: [], error }` and never throws, so one bad source can't kill a sync
(`sources.ts:3`, `sources.ts:106-134`). But `runIngest` then does:

```ts
const { jobs: rawJobs, errors } = await fetchAllSources();  // adzuna failed → 0 adzuna jobs
const freshIds = rows.map((r) => r.id);                     // greenhouse only
const { data: existingRows } = await client.from("roles").select("id").in("source", INGESTED_SOURCES);
const toExpire = classifyExpiry(existingIngestedIds, freshIds);  // ← every adzuna role
```

`classifyExpiry` (`pipeline.ts:30-33`) compares **all** ingested ids against **this
pull's** ids with no notion of source. So an Adzuna 503 flips `is_live = false` on
all ~44 Adzuna roles.

Survivable today (a human sees `errors` in the button's response). **A daily cron
makes it silent:** roles quietly halve at 3am and self-heal next run — if the
source recovers.

---

## 4. Architecture

```
Vercel Cron (daily, 0 3 * * *)
   │  GET /api/cron/ingest
   │  Authorization: Bearer $CRON_SECRET     ← Vercel adds this automatically
   ▼
/api/cron/ingest  (GET)
   ├─ 1. reject unless CRON_SECRET is SET and the header matches   → 401
   ├─ 2. sign in bot (INGEST_BOT_EMAIL / INGEST_BOT_PASSWORD)      → 500 + logError on failure
   ├─ 3. runIngest(botClient)        ← UNCHANGED shared pipeline
   ├─ 4. writeSyncRun(botClient, "cron", summary)
   ├─ 5. trackServer("ingest_run", { trigger, added, updated, expired, sources_ok, sources_failed })
   └─ 6. 200 { summary }

/api/ingest  (POST, admin JWT)     ← Stage 8, unchanged except steps 4-5 added
   └─ runIngest(adminClient) → writeSyncRun(..., "manual", ...) → trackServer(...)
```

Both callers converge on `runIngest(client)`. The **only** difference is which JWT
the client carries. RLS on `roles` (`is_admin() or is_ingest_bot()`) is the single
write gate for both.

---

## 5. Components

### 5.1 `src/app/api/cron/ingest/route.ts` (new)
- **Does:** authenticates the cron, signs in the bot, runs the pipeline, logs the run.
- **Interface:** `GET` → `200 { run_id, added, updated, expired, bySource, errors, warnings }` · `401` · `500`.
- **Depends on:** `runIngest`, `writeSyncRun`, `trackServer`, `logError`.
- **Auth:** fails **closed** — `if (!process.env.CRON_SECRET) return 401`. A missing
  env var must never leave the endpoint open. Compared against
  `Bearer ${CRON_SECRET}` exactly (Vercel's documented contract).
- `export const dynamic = "force-dynamic"` (matches `/api/ingest`).

### 5.2 `src/lib/ingest/pipeline.ts` (modified)
- `dedupe()` — sort by `jd_text.length` desc instead of `SOURCE_ORDER`; keep-first on
  the existing lowercased `(company|title|location)` key. **(D5)**
- `classifyExpiry(existingBySource, freshBySource, skipSources)` — per-source, and
  returns `[]` for any source in `skipSources`. Stays pure and unit-tested. **(D3)**
- `runIngest()` — tracks `fetched` per source, derives `skipSources` from
  (a) sources with an error, (b) the D4 circuit breaker, and returns
  `{ added, updated, expired, bySource, errors, warnings }`.

**Required supporting change — the existing-rows query must widen.** Today
`runIngest` selects only `id` (`pipeline.ts:53-56`). Per-source expiry needs
`source`, and the D4 circuit breaker needs `is_live`:

```ts
// was: .select("id").in("source", INGESTED_SOURCES)
const { data: existingRows } = await client
  .from("roles")
  .select("id, source, is_live")
  .in("source", INGESTED_SOURCES);
```

**`previouslyLive` is defined as:** the count of `existingRows` where
`source === s && is_live === true`, measured **before** this run's upsert. This is
the only new data the circuit breaker needs — no extra query.

### 5.2b `src/lib/ingest/types.ts` (modified)
`IngestSummary` gains `warnings: string[]`, and `bySource` widens from
`Record<JobSource, number>` to `Record<JobSource, { fetched: number; ok: boolean }>`
so `writeSyncRun` can emit one row per source without recomputing anything.
Existing `added`/`updated`/`expired` totals stay for backward compatibility with the
admin button's current response shape.

### 5.3 `src/lib/ingest/syncRuns.ts` (new)
- **Does:** writes one `sync_runs` row per source for a run; reads the latest run.
- **Interface:** `writeSyncRun(client, trigger, summary): Promise<string /* run_id */>` ·
  `getLatestSyncRun(client): Promise<SyncRunRow[]>`.
- **Never fails the ingest** — a logging error is swallowed and pushed into `errors`.

### 5.4 `src/lib/analytics.ts` (modified)
- Add `trackServer(name, props): Promise<void>` — mirrors `logError`: direct insert,
  never throws, **no `window` guard**, `uid = null`. Add `"ingest_run"` to `EventName`.
- **PII rule unchanged:** counts/enums/booleans only. Never company names, JD text,
  or the bot's email.

### 5.5 `src/app/admin/…` (modified)
- Last-run card: per-source `fetched / inserted / updated / expired`, error and
  warning strings, relative time, and `trigger`. Reads via `getLatestSyncRun` with
  the admin's existing JWT. States: loading / never-run / ok / warnings / errors.

### 5.6 `scripts/stage12-cron-ingestion.sql` (new, idempotent)
- `is_ingest_bot()` — email allow-list, mirrors `is_admin()`'s shape. **(D2)**
- `roles` write policies → `is_admin() or is_ingest_bot()`.
- `sync_runs` table + RLS: `insert` for admin-or-bot, `select` for admin, **nothing
  for `anon`**.

### 5.7 `vercel.json` (new)
```json
{ "crons": [{ "path": "/api/cron/ingest", "schedule": "0 3 * * *" }] }
```
Hobby: crons fire only from **production** deployments, and a daily schedule fires
*within* the hour, not on the minute. One cron, well inside the Hobby limit.

---

## 6. Data model

```sql
create table if not exists public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null,                  -- groups the per-source rows of one run
  run_at      timestamptz not null default now(),
  trigger     text not null,                  -- 'cron' | 'manual'
  source      text not null,                  -- 'greenhouse' | 'lever' | 'adzuna'
  fetched     int  not null default 0,        -- PM jobs after filter, before dedupe
  inserted    int  not null default 0,
  updated     int  not null default 0,
  expired     int  not null default 0,
  ok          boolean not null default true,  -- false if this source errored
  errors      text[] not null default '{}',
  warnings    text[] not null default '{}'    -- e.g. the D4 circuit breaker
);
create index if not exists sync_runs_run_at_idx on public.sync_runs (run_at desc);
```

---

## 7. Security

- **No service-role key.** Unchanged rule.
- **No new publicly-callable RPC.** The only write gate stays RLS on `roles`.
- **Bot least privilege (D2):** `is_ingest_bot()` grants `roles` writes only. The bot
  is **not** an admin — it cannot read `referral_applications` or override statuses.
- **Bot credentials** (`INGEST_BOT_EMAIL`, `INGEST_BOT_PASSWORD`) are server env only
  — never `NEXT_PUBLIC_*`. `.env.example` gets placeholders; real values go in Vercel.
- **`CRON_SECRET`** server env only; the route fails closed if it is unset.
- **`sync_runs`** is invisible to `anon` (no policy) — it names companies and failure
  modes, so it is admin-read-only, not client-readable.
- **Blast radius if the bot password leaks:** the attacker can write `roles`
  (inject/deface job listings). They cannot touch `applications`, referrals, or
  `ai_usage`. Mitigation: rotate the password; roles self-heal on the next sync.

---

## 8. Error handling

| Failure | Behaviour |
|---------|-----------|
| `CRON_SECRET` unset or header mismatch | `401`, nothing runs |
| Bot sign-in fails | `500` + `logError`, **no** writes attempted, `sync_runs` row with `ok = false` |
| One source errors | Recorded per-source (`ok = false`); other sources proceed; **expiry skipped for that source** (D3) |
| Source returns 0 with >0 live | Expiry skipped + warning (D4); surfaced in the admin card |
| Upsert fails | Existing Stage 8 behaviour: no phantom counts, expiry skipped |
| `sync_runs` insert fails | Swallowed into `errors`; never fails the ingest |
| Route throws | `500` with a generic message — never echo keys or upstream bodies (Stage 8 rule) |

---

## 9. Testing

**Unit (`scripts/tests/*.test.ts`, existing `npx tsx` pattern):**
1. `dedupe` prefers the longer `jd_text` across sources for one `(company,title,location)`.
2. `dedupe` still collapses exact duplicates and keeps distinct titles **separate**
   (the false-merge guard from D5).
3. `classifyExpiry` scopes per source — a greenhouse pull never expires adzuna rows.
4. `classifyExpiry` returns `[]` for a source in `skipSources` (**the D3 bug**).
5. Circuit breaker: `fetched = 0` + `previouslyLive > 0` → skip + warning (**D4**).
6. Circuit breaker does **not** fire when `previouslyLive = 0` (a genuinely new source).

**Integration / live:**
7. `GET /api/cron/ingest` with **no** header → `401`.
8. Same with a **wrong** secret → `401`.
9. Same with the correct secret → `200`, `sync_runs` rows appear, `/roles` shows ingested rows.
10. **Anon probe:** `curl` `sync_runs` with the anon key → `[]` (per Stage 11's three-leg
    method: control + attack + app-path).
11. Admin card renders the last run.

---

## 10. Env vars (all server-side)

| Var | Purpose |
|-----|---------|
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer …`; route fails closed if unset |
| `INGEST_BOT_EMAIL` | Bot's Supabase auth email (mirrored in `is_ingest_bot()`) |
| `INGEST_BOT_PASSWORD` | Bot's password |

Manual setup (user, before the code works): create the bot user in Supabase Auth,
run `scripts/stage12-cron-ingestion.sql`, set the three env vars in Vercel.

> **Stage 11 lesson applies:** the migration and the deploy are **one atomic change**.
> This migration is additive (new fn/table, widened policies), so it is safe to run
> before the deploy — but the stage is not done until both are live and verified
> against the **production URL**, not localhost.

---

## 11. v2 seams

- `// TODO(v2):` more than one run/day (needs a paid plan); per-source schedules.
- `// TODO(v2):` alerting on N consecutive failed runs (email/webhook).
- `// TODO(v2):` revisit fuzzy dedupe **only** if real duplicates are observed on `/roles`.
- `// TODO(v2):` retention/cleanup for `sync_runs`.
</content>
</invoke>
