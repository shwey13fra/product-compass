# Stage 8 — Job Ingestion from Legal Sources (Design)

> Date: 2026-07-07 · Status: approved design, pre-implementation.
> Builds on Stages 1–7 (live at https://product-compass-lilac.vercel.app).

## 1. Problem & goal

The 50 curated `roles` are **illustrative sample data** (hand-authored in
`scripts/roles-data.mjs`), not live listings. Stage 8 replaces them, over time,
with **real PM openings pulled from legal, public sources** — no scraping of
LinkedIn/Naukri (no public jobs API; against their ToS). Once ingestion proves
out, the sample roles get deleted.

**Success:** an admin clicks "Sync jobs now" → the app pulls PM roles from
Greenhouse + Lever + Adzuna, scores them with a rule-based (no-AI) real-PM
scorer, normalizes them into the existing `roles` schema, dedupes/expires, and
they appear in browse — badged by source, with "Apply" linking out to the real
posting. No billable cost to run a sync.

## 2. Sources (all server-side)

1. **Greenhouse** (public, no auth): `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`. Board tokens from `GREENHOUSE_BOARDS` in `src/config.ts`.
2. **Lever** (public, no auth): `https://api.lever.co/v0/postings/{company}?mode=json`. Company slugs from `LEVER_COMPANIES` in `src/config.ts`.
3. **Adzuna** (India breadth): query `country=in`, `what="product manager"`. `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` from **server env only** (never `NEXT_PUBLIC_`).

**Cost:** Greenhouse/Lever free & unauthenticated. Adzuna free tier (register
for keys); rate-limited but never billed on overage — a rate-limit response is
an error, not a charge. **Zero Anthropic credits** — the scorer is pure JS.

## 3. Key decisions (approved)

- **A1 — writes via forwarded admin JWT.** `roles` is RLS-locked to admin
  writes (`scripts/stage7-auth-referrals.sql`), and `service_role` is banned by
  CLAUDE.md. The "Sync jobs now" button (admin is signed in) sends the Supabase
  access token in `Authorization`; the route builds a per-request Supabase
  client with that JWT so writes run **as the admin** and pass RLS. The route
  re-checks `isAdminEmail(user.email)` server-side.
- **B — new pure-JS scorer.** No real-PM scorer exists today (seed scores were
  hand-authored). Build `src/lib/realPmScore.ts`, reusing the keyword-theme
  approach proven in `positioning.ts`. No AI, no credits.
- **`source='seed'` tagging.** The new `source` column double-duties as the
  "dummy data" marker: seed rows → `'seed'`, badged "Sample", deletable later
  with `delete from roles where source='seed'`.
- **Same `roles` table** (not a separate `ingested_jobs` table): the app already
  reads `roles`, so ingested jobs light up browse + fit-read for free.

## 4. Schema migration — `scripts/stage8-job-ingestion.sql` (idempotent)

```sql
alter table public.roles
  add column if not exists source       text,
  add column if not exists external_id  text,
  add column if not exists apply_url    text,
  add column if not exists ingested_at  timestamptz;

-- Tag existing dummy rows so they're deletable later.
update public.roles set source = 'seed' where source is null;

-- Dedupe/upsert key for ingested rows.
create unique index if not exists roles_source_external_id_uidx
  on public.roles (source, external_id)
  where external_id is not null;
```

- No new RLS: existing public-read + admin-write policies on `roles` cover
  ingested rows.
- Ingested `roles.id` is composed deterministically: `` `${source}:${external_id}` ``
  (e.g. `greenhouse:4012345`) so upserts are stable across syncs.

## 5. Config & secrets

- `src/config.ts` (non-secret; tokens appear in public URLs):
  `export const GREENHOUSE_BOARDS: string[] = [ ... ]` and
  `export const LEVER_COMPANIES: string[] = [ ... ]`. Editing = commit → deploy.
- Server env only (add placeholders to `.env.example`): `ADZUNA_APP_ID`,
  `ADZUNA_APP_KEY`.

## 6. Scorer — `src/lib/realPmScore.ts` (pure JS, no AI)

`scoreRealPm(title: string, jd: string): { score: number; signals: string[] }`

- **Positive** keyword groups (add): discovery/user research; "own the roadmap /
  what & why"; outcome/north-star/metric ownership; defines strategy.
- **Negative** groups (subtract): delivery/coordination; sprint/ticket
  throughput; requirements-gathering; timeline/release/project management.
- Sum → clamp to 0–100. Bands render via the existing `getBand()`
  (70+ genuine / 40–69 verify / <40 disguised).
- Emits `signals: string[]` in the same human-readable shape the UI already
  renders (e.g. "owns discovery & user research", "ticket throughput focus").
- **Honesty:** auto-scoring is rougher than hand-authored scores; the source
  badge keeps this transparent to the user.

## 7. Ingest pipeline — `src/lib/ingest/`

- `src/lib/ingest/types.ts` — `RawJob`, `NormalizedRole`, `IngestSummary`.
- `src/lib/ingest/sources.ts` — `fetchGreenhouse(token)`, `fetchLever(company)`,
  `fetchAdzuna()`. Each **best-effort**: wrapped so one source failing (or
  Adzuna rate-limiting) never kills the others; returns `{ jobs, error? }`.
  Adzuna capped at ~50 rows, one query.
- `src/lib/ingest/normalize.ts` — `RawJob → NormalizedRole`:
  - **PM-title filter:** keep titles matching product manager / senior PM / APM /
    group PM; **exclude** "project manager" and "program manager".
  - Fields: `source`, `external_id`, `apply_url`, `ingested_at=now`,
    `is_referral=false`, `has_warm_path=false`, `warm_path_note=null`,
    `crowd_response_days=14` (generic default — no real crowd data for ingested),
    `location` from source, `jd_text` from source content.
  - `real_pm_score` + `real_pm_signals` from `scoreRealPm()`.
  - `archetype` inferred from title/JD keywords (best-effort; default `b2c`).
- `src/lib/ingest/pipeline.ts` — `runIngest(adminClient): Promise<IngestSummary>`:
  1. fetch all configured sources,
  2. filter + normalize + score,
  3. **dedupe** by `id`, then cross-source by normalized `company|title|location`
     (ATS preferred over Adzuna),
  4. **upsert** (onConflict `id`) → count added vs updated,
  5. **expire** pass: ingested roles (`source in ('greenhouse','lever','adzuna')`)
     absent from this pull → `is_live=false`, `freshness_checked_at=now`.
     **Never touches `source='seed'` or `is_referral=true` rows.**
  6. return `{ added, updated, expired, bySource, errors[] }`.

## 8. Route — `src/app/api/ingest/route.ts` (POST only)

1. Read `Authorization: Bearer <token>`; `supabase.auth.getUser(token)`.
   → **401** if no/invalid token; **403** if `!isAdminEmail(user.email)`.
2. Build per-request Supabase client carrying that JWT (Decision A1).
3. `runIngest(adminClient)`; return the summary as JSON.
4. Errors sanitized — never echo keys or raw upstream bodies. **No AI call.**

## 9. UI

- `src/app/admin/page.tsx` — **"Sync jobs now"** button (admin area already
  gated). Click → read session token → `POST /api/ingest` with `Authorization`
  → loading state → **summary card** (added / updated / expired, per-source
  counts, source errors as soft warnings). `// TODO(v2): Vercel Cron daily sync`.
- **Badges** (`RoleCard` + role-detail header): `source='seed'` → muted
  **"Sample"** chip; ingested → **"Greenhouse" / "Lever" / "Adzuna"** chip.
  Warm Clay tokens only, no hardcoded hex.
- **Apply (role detail):** ingested role → primary CTA **"Apply on {source} ↗"**
  opening `apply_url` in a new tab (no fake apply). Cold-path: fit read + crowd
  stat; **no warm collaboration**. Admin referral roles keep their warm thread.

## 10. States & testing

- Every state handled: sync loading, per-source error (partial success still
  saves), "no new jobs" empty summary, success card.
- **Verification (mirrors how `positioning.ts` was proven):**
  - Standalone Node test of the scorer: a discovery/outcome-owning JD → 70+; a
    delivery/coordination JD → <40.
  - Filter test: "Program Manager" / "Project Manager" excluded; "Senior Product
    Manager" kept.
  - Dedupe test: same job from two sources collapses to one row.
  - `npx tsc --noEmit` + `npx next build` clean.
  - **Live sync**: one real Greenhouse token + Adzuna keys → rows appear badged,
    Apply links out, and the write succeeding **proves the JWT/RLS path E2E**.

## 11. Out of scope (v2 seams, left marked)

- Vercel Cron automatic daily sync (`// TODO(v2)` in the route/admin).
- Tracking integration for ingested roles (external apply only in v1 of Stage 8).
- AI-assisted scoring.
- Dedupe across seed ↔ ingested (seed roles are being deleted anyway).

## 12. Deliverable — "how to run it" (returned to the user on completion)

1. **Add a Greenhouse company:** find its board at
   `boards.greenhouse.io/{token}`; add `'{token}'` to `GREENHOUSE_BOARDS` in
   `src/config.ts`; commit → auto-deploy.
2. **Add a Lever company:** find `jobs.lever.co/{company}`; add `'{company}'` to
   `LEVER_COMPANIES`.
3. **Set Adzuna keys:** register at `developer.adzuna.com`; add `ADZUNA_APP_ID` +
   `ADZUNA_APP_KEY` to `.env.local` and to Vercel env (Production); redeploy.
4. **Run a sync:** sign in as an admin → `/admin` → **"Sync jobs now"** → read the
   summary (added / updated / expired).

## 13. Files touched

**New:** `scripts/stage8-job-ingestion.sql`, `src/lib/realPmScore.ts`,
`src/lib/ingest/{types,sources,normalize,pipeline}.ts`,
`src/app/api/ingest/route.ts`.
**Edited:** `src/config.ts` (board lists), `.env.example` (Adzuna placeholders),
`src/lib/types.ts` + `src/lib/roles.ts` (`ROLE_COLUMNS` += new fields),
`src/app/admin/page.tsx` (sync button + summary),
`src/components/RoleCard.tsx` + `role-badges.tsx` (source badge),
`src/app/roles/[id]/page.tsx` (apply-out CTA for ingested roles).
