# Stage 12 — Verification: daily cron ingestion

> **Purpose.** Prove the Stage 12 claims against the real project:
>
> 1. **The cron endpoint cannot be triggered by anyone but Vercel** — and fails
>    closed if `CRON_SECRET` is unset.
> 2. **No new attack surface** — the cron writes as a least-privilege bot through
>    the same RLS gate as the admin button. No service-role, no public write RPC.
> 3. **A source outage no longer delists that source's roles** (the Stage 8 bug).
> 4. **Every run is logged and visible** in `sync_runs` + the admin card.
>
> **Run status: 🟡 PARTIAL — code verified 2026-07-15; live steps blocked on the
> user's manual setup (§0).** Sections a–b passed. Sections c–f pending.

---

## 0. Setup — the user must do this first, in this order

The code **cannot work** until all three are done. `sync_runs` writes are swallowed
by design, so a missing migration shows up as a quiet "No sync has run yet" rather
than an error.

1. **Create the bot user.** Supabase → Authentication → Users → **Add user** →
   email + password, **Auto Confirm User ON**. Suggested:
   `shwetaswain13november+ingestbot@gmail.com` (the `+alias` trick from Stage 8 —
   it lands in the same inbox but is a distinct identity).
2. **Run the migration.** Open `scripts/stage12-cron-ingestion.sql`, replace
   **`BOT_EMAIL_HERE`** with that email, run it in the SQL editor.
3. **Set env vars** in **Vercel** (Production) *and* `.env.local`:
   `CRON_SECRET` (any long random string), `INGEST_BOT_EMAIL`,
   `INGEST_BOT_PASSWORD`.

> **Vercel Hobby:** crons fire **only from production deployments**, and a daily
> schedule fires *within* the given hour, not on the minute. So the nightly run
> only starts once this branch is merged to `main` and deployed.

> **Stage 11 lesson:** the migration and the deploy are **one atomic change**. This
> migration is additive (new predicate, widened policies, new table), so it is safe
> to run before the deploy — but the stage is not done until both are live and
> verified against the **production URL**, not localhost.

---

## a. The cron auth gate ✅ PASSED (2026-07-15, local)

All three branches must be distinguished. If every request returns 401, you have
**not** proven the gate opens — only that it rejects.

| # | Request | Expected | **Actual** |
|---|---------|----------|-----------|
| a1 | No `Authorization` header, `CRON_SECRET` **unset** | `401 {"error":"Not configured."}` | ✅ fail-closed — a missing env var never leaves the endpoint open |
| a2 | No header, `CRON_SECRET` **set** | `401` | ✅ |
| a3 | **Wrong** secret | `401 {"error":"Unauthorized."}` | ✅ the **comparison** branch, distinct from a1's fail-closed |
| a4 | **Correct** secret (bot env absent) | `500 {"error":"Server misconfigured."}` | ✅ **auth passed** and stopped at the bot env — this is what proves the gate opens |

```powershell
curl.exe -s http://localhost:3000/api/cron/ingest
curl.exe -s http://localhost:3000/api/cron/ingest -H "Authorization: Bearer wrong"
curl.exe -s http://localhost:3000/api/cron/ingest -H "Authorization: Bearer $env:CRON_SECRET"
```

## b. The Stage 8 expiry bug ✅ PASSED (unit, 2026-07-15)

`npx tsx scripts/tests/skipSources.test.ts` · `npx tsx scripts/tests/pipeline.test.ts`

| # | Assertion | **Actual** |
|---|-----------|-----------|
| b1 | A skipped source is **never** expired — `classifyExpiry(existing, ["greenhouse:g1"], ["adzuna"])` omits `adzuna:a5` | ✅ |
| b2 | A source that errored (`ok: false`) is skipped + warned | ✅ |
| b3 | Circuit breaker: `fetched = 0` while `previouslyLive > 0` → skip + warn | ✅ |
| b4 | Circuit breaker does **not** fire for a genuinely new source (`previouslyLive = 0`) | ✅ |
| b5 | Already-dead rows aren't re-expired (honest `expired` count) | ✅ |
| b6 | Richer JD wins across sources; **ties fall back to source rank** | ✅ (the fallback is load-bearing — stable sort would let input order decide) |

Also: `tsc --noEmit` clean · `next build` clean, `ƒ /api/cron/ingest` registered ·
all 5 test suites green.

---

## c. Live cron run ⬜ PENDING (needs §0)

| # | Action | Expected |
|---|--------|----------|
| c1 | `curl` prod `/api/cron/ingest` with **no** header, then a **wrong** secret | `401` both |
| c2 | `curl` prod with the **correct** secret | `200` + `{ run_id, added, updated, expired, bySource, errors, warnings }` |
| c3 | `/roles` still lists ingested roles; badges intact | no regression |

```powershell
curl.exe -s -w "`nHTTP %{http_code}`n" https://product-compass-lilac.vercel.app/api/cron/ingest -H "Authorization: Bearer $env:CRON_SECRET"
```

## d. No new attack surface ⬜ PENDING (Stage 11's three-leg method)

Control + attack + app-path. **The control is what makes `[]` meaningful** — without
it, `[]` could just mean "empty table" (the trap from `PAST_MISTAKES.md`).

| # | Request (anon key, from PowerShell — **not** the SQL editor) | Expected |
|---|---------|----------|
| d1 | **CONTROL** `roles?select=id&limit=1` | rows → the key works |
| d2 | **ATTACK** `sync_runs?select=*` | `[]` → invisible to the client |
| d3 | **ATTACK** `roles` insert with the anon key | denied → RLS still the gate |
| d4 | Confirm **no** `ingest_upsert_roles` RPC exists | 404 → we never shipped a public write RPC |

## e. The bug fix, live ⬜ PENDING — the most valuable check

Simulate a source outage and prove roles survive it:

1. Unset `ADZUNA_APP_ID` in `.env.local` (→ `fetchAdzuna` returns
   `"adzuna: keys not configured"`).
2. Run the route locally with the correct secret.
3. In SQL: `select source, fetched, ok, expired, warnings from sync_runs order by run_at desc limit 3;`

**Expected:** `adzuna` row shows `ok = false`, a warning, and **`expired = 0`** —
the outage did **not** delist Adzuna's roles. Restore the key afterwards.
*(Before this stage, that same outage would have flipped `is_live = false` on all
~44 Adzuna roles.)*

## f. Logging + admin card ⬜ PENDING

| # | Action | Expected |
|---|--------|----------|
| f1 | `/admin` as an admin | **Last sync** card: per-source `fetched`/`expired`, `ok` ticks, relative time, `cron` vs `manual` |
| f2 | Click **Sync jobs now**, reload `/admin` | card updates, `trigger = manual` |
| f3 | `select name, props from events where name = 'ingest_run' order by created_at desc;` | rows with `{trigger, added, updated, expired, sources_ok, sources_failed}`, **no PII** |
| f4 | After the first nightly cron | a `trigger = 'cron'` row appears |

---

## Bugs found

| Step | What happened | Expected | Severity |
|------|---------------|----------|----------|
| — | *(fill in during the live run)* | | |

## Parked

- **Fit read shows `10% / "Nothing detected yet"`** while the generated brief is
  detailed about the same experience — suspect `computeFitRead` theme-matching in
  `src/lib/positioning.ts`. Pre-dates Stage 12; on the HERO flow.
- Stage 9 three-persona RLS proof + Stage 10 error-capture test: user-confirmed
  done, no artifacts recorded.
</content>
</invoke>
