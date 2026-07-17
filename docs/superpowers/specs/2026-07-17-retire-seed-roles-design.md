# Stage 13 — Retire the seed sample roles

> **Status:** design approved 2026-07-17.
> **Why now:** Stage 8 tagged the 50 curated roles `source='seed'` and badged them
> "Sample", with the explicit decision *"delete later once ingestion works"*
> (`DECISIONS.md`, 2026-07-07). Nightly ingestion started running unattended on
> 2026-07-17 03:27 UTC (`VERIFICATION_STAGE12.md` §f4) and delivers **73 real
> roles**. The condition is met.

## The problem

Three commitments point at the same deletion:

1. **The Stage 8 promise.** The samples were always scaffolding.
2. **The portfolio standard** (`CLAUDE.md`): *"a working core flow on real data
   (not mock)"*. **49 of 122 live roles are fabricated** and badged "Sample" —
   the standard is violated in the most visible place in the product.
3. **The fit read fix** (2026-07-17): 36 roles now honestly report "can't score"
   because their JD is too thin. **22 of those 36 are seed rows** (83–171 char
   hand-written JDs). Retiring them takes it to 14/73, and those 14 are Adzuna's
   API truncation — a real upstream constraint, not our own mock data.

## Two traps found while designing this

**1. The documented cleanup is booby-trapped.** `scripts/stage8-job-ingestion.sql:14`
says:

```sql
-- deletable later with:  delete from public.roles where source = 'seed';
```

Running that as written **deletes the Stage 7 referral role**. There is one live
role with `is_referral = true` **and** `source = 'seed'`. Nothing would error;
the warm path would just quietly lose its only role.

**2. Why the referral role is in the seed bucket — the root cause.**
`adminCreateReferralRole` (`src/lib/referrals.ts`) never sets `source`, and the
column has **no default**. Stage 8 backfilled `update roles set source='seed'
where source is null`, sweeping the then-existing referral role in. Any *new*
referral role today gets `source = NULL`. Fixing only the predicate would leave
the generator of the problem in place.

**Counts:** 49 live seed rows = **48 samples + 1 referral role**.

## Design

### 1. Retire, don't delete

```sql
update public.roles
   set is_live = false, freshness_checked_at = now()
 where source = 'seed' and is_live = true and is_referral is not true;
-- expect: 48 rows
```

Rationale, in the project's own established terms:

- **Consistent with the pattern already chosen.** `stage12-cron-ingestion.sql`:
  *"The bot never deletes: expiry flips `is_live=false` and keeps history."* The
  `roles admin delete` policy was deliberately left admin-only and unused. A
  sample role going away is the same event as a job posting going away — use the
  same mechanism.
- **No orphans.** `applications.role_id` is `text not null` with **no foreign key**
  (`applications-table.sql:14`, `stage7-auth-referrals.sql:110-112`), and briefs
  are keyed `compass_brief:<roleId>` in localStorage. A hard delete would not
  error — it would silently leave tracking rows and saved briefs pointing at
  nothing.
- **Reversible.** One statement restores them if 73 roles reads too thin.
- **Sufficient.** `roles.ts:73` filters `.eq("is_live", true)`, so browse hides
  them immediately.

### 2. Fix the root cause

- `adminCreateReferralRole` sets `source = 'referral'` explicitly.
- Correct the booby-trapped comment in `scripts/stage8-job-ingestion.sql:14` so
  the unsafe statement is never run later.

### 3. Explicitly out of scope

Removing the `Sample` badge / `sourceLabel` / `source='seed'` machinery. The rows
still exist — the code is not dead, it is correctly rendering nothing. Stripping
it is a separate decision and would have to survive a rollback of §1.

## Verification

| # | Check | Expected |
|---|-------|----------|
| a | Run the migration | exactly **48** rows updated — not 49 (referral survives), not 0 |
| b | `/roles` | **74** roles = 73 ingested + the 1 surviving referral role. Zero "Sample" badges on the 73; the referral role keeps its own badge |
| c | All seven archetype filters | non-empty: ai 22 · b2c 18 · technical 11 · growth 8 · zero_to_one 8 · b2b 3 · platform 3 (+1 wherever the referral role sits) |
| d | The referral role | still listed, still badged "Referral available", warm path intact |
| e | A brief saved against a retired role | still opens (row survives, id resolves) |
| f | Fit read "can't score" count | drops 36 → **14**, all `adzuna` |
| g | Post a NEW referral role via `/admin` | lands with `source = 'referral'`, not NULL |

> **The control that makes this meaningful (the `PAST_MISTAKES.md` three-leg rule):**
> check (a)'s row count **before** trusting (b). A plausible-looking roles list
> would look much the same whether we retired 48 samples or accidentally retired
> 49 and broke the warm path — the difference is a single role among ~74. Check
> (d) is the leg that distinguishes them, and (a)'s `48` is what makes (b) mean
> anything. **74, not 73, is the pass condition** — 73 would mean the referral
> role went down with the samples.

## Rollback

```sql
update public.roles set is_live = true
 where source = 'seed' and is_referral is not true;
```

Safe because ingestion never touches `source='seed'` rows: `runIngest` scopes
every read and expiry to `.in("source", INGESTED_SOURCES)` where
`INGESTED_SOURCES = ['greenhouse','lever','adzuna']` (`pipeline.ts:76,102`).
