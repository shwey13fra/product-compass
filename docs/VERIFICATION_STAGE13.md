# Stage 13 — Verification: brief feedback

> **Purpose.** Prove the Stage 13 claims against the real project:
>
> 1. **`brief_feedback` is invisible to the client** — a uid can only ever touch
>    its own row, and only through the RPCs. No enumeration.
> 2. **A rating persists** and shows on revisit.
> 3. **The apply prompt asks once**, is dismissible, and only for roles with a brief.
> 4. **The note text never reaches `events`** — no PII.
> 5. **A brief saved before Stage 13 still opens** and reports mode `unknown`.
>
> **Run status: 🟡 code complete, NOTHING live-verified. Every Actual below is
> unfilled on purpose.** Blocked on §0.

---

## 0. Setup — the user must do this first

1. **Run the migration.** Paste `scripts/stage13-brief-feedback.sql` into the
   Supabase SQL editor and run it. Expected: `Success. No rows returned.`
2. **Nothing else.** No new env vars, no AI keys — this stage spends nothing.

> **Stage 11 lesson:** the migration and the deploy are **one atomic change**, and
> dev/prod share one Supabase project. This migration is **additive** (a new table
> + new functions), so it is safe to run before the deploy — but the stage is not
> done until both are live and verified against the **production URL**.

---

## a. Isolation — three legs ⬜ NOT RUN

**The control is what makes `[]` mean anything.** Without leg (a), leg (b)'s empty
array could just mean "empty table" — the trap in `PAST_MISTAKES.md`.
Run from a terminal, **not** the SQL editor (service-role bypasses the very thing
under test).

```powershell
$URL = ((Get-Content .env.local | Where-Object { $_ -like 'NEXT_PUBLIC_SUPABASE_URL=*' }) -split '=',2)[1].Trim()
$KEY = ((Get-Content .env.local | Where-Object { $_ -like 'NEXT_PUBLIC_SUPABASE_ANON_KEY=*' }) -split '=',2)[1].Trim()

# a1 CONTROL
curl.exe -s "$URL/rest/v1/roles?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# a2 ATTACK — the table
curl.exe -s "$URL/rest/v1/brief_feedback?select=*" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# a3 ATTACK — direct insert
curl.exe -s -X POST "$URL/rest/v1/brief_feedback" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{\"uid\":\"attacker\",\"role_id\":\"x\",\"brief_mode\":\"live\",\"rating\":\"thumbs_up\"}'
# a4 APP PATH — the RPC
curl.exe -s -X POST "$URL/rest/v1/rpc/rate_brief" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{\"p_uid\":\"test-uid-1\",\"p_role\":\"test-role-1\",\"p_mode\":\"live\",\"p_rating\":\"thumbs_up\",\"p_note\":null}'
# a5 ATTACK — someone else's uid
curl.exe -s -X POST "$URL/rest/v1/rpc/get_brief_feedback" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{\"p_uid\":\"test-uid-1\",\"p_role\":\"test-role-1\"}'
```

| # | Leg | Expected | **Actual** |
|---|-----|----------|-----------|
| a1 | **CONTROL** `roles` select | a row → the key works | ⬜ not run |
| a2 | **ATTACK** `brief_feedback` select | `[]` → invisible | ⬜ not run |
| a3 | **ATTACK** direct insert | denied (`42501`) → RLS is the gate | ⬜ not run |
| a4 | **APP PATH** `rpc/rate_brief` | the row returns → the door works | ⬜ not run |
| a5 | **ATTACK** `rpc/get_brief_feedback` with a uid you hold | returns only that uid's row; **no RPC lists uids**, so holding a uid is the only way in | ⬜ not run |

Cleanup afterwards: `delete from public.brief_feedback where uid = 'test-uid-1';`

## b. Rating persists ⬜ NOT RUN

| # | Action | Expected | **Actual** |
|---|--------|----------|-----------|
| b1 | Generate a brief, click 👍 | "Thanks" appears | ⬜ not run |
| b2 | Reload the role page | 👍 still selected (read back via `get_brief_feedback`, not localStorage) | ⬜ not run |
| b3 | Click 👎, type a note, blur | note saves | ⬜ not run |
| b4 | Switch back to 👍 | note is **cleared** (`rate_brief` nulls it — a stale complaint must not survive the user changing their mind) | ⬜ not run |

## c. The apply prompt ⬜ NOT RUN

| # | Action | Expected | **Actual** |
|---|--------|----------|-----------|
| c1 | Mark as Applied on a role **with** a brief | the one question appears | ⬜ not run |
| c2 | Answer Yes | `used_in_application = true` | ⬜ not run |
| c3 | Reload | prompt does **not** re-appear (it only shows right after an apply) | ⬜ not run |
| c4 | Dismiss (×) on another role | `used_in_application` stays **null** — this is why the column is nullable | ⬜ not run |
| c5 | Mark as Applied on a role with **no** brief | **no** prompt | ⬜ not run |

## d. No PII in events ⬜ NOT RUN

```sql
select name, props, created_at from public.events
 where name in ('brief_rated','brief_used_reported')
 order by created_at desc limit 10;
```

| # | Check | Expected | **Actual** |
|---|-------|----------|-----------|
| d1 | `brief_rated` props | `{role_id, mode, rating}` — **no note text** | ⬜ not run |
| d2 | `brief_used_reported` props | `{role_id, used}` | ⬜ not run |

## e. `/admin/quality` ⬜ NOT RUN

| # | Action | Expected | **Actual** |
|---|--------|----------|-----------|
| e1 | As an admin | counts by mode, usage rate, recent notes | ⬜ not run |
| e2 | Signed out / non-admin | "Admins only" — **and** the query returns nothing even if the gate were bypassed, because the `select` policy requires `is_admin()` | ⬜ not run |

## f. The legacy brief ⬜ NOT RUN — the data-loss guard

| # | Action | Expected | **Actual** |
|---|--------|----------|-----------|
| f1 | Open a role whose brief was saved **before** Stage 13 | the brief still renders (`loadBrief` guards `version !== 1`; bumping the version would have wiped every saved brief on every device) | ⬜ not run |
| f2 | Rate it | lands as mode `unknown`, not a guessed `live` | ⬜ not run |

Covered by `scripts/tests/storedBrief.test.ts` at the unit level; f1/f2 confirm it
against a real device's localStorage.

---

## Known gaps (recorded, not skipped)

- **The warm path is never asked.** `ReferralApplyButton` calls
  `router.push("/referrals/<id>")` the instant the apply succeeds, so a prompt
  would unmount before it was seen. `/admin/quality` labels the usage rate
  **cold-path only**. Covering it means putting the question on `/referrals/[id]`.
  `// TODO(v2)`.
- **n is tiny.** With one user generating data, the live-vs-manual split is
  descriptive, not evidence. The view says so. It cannot yet answer "is Sonnet
  worth the spend".

## Bugs found

| Step | What happened | Expected | Severity |
|------|---------------|----------|----------|
| — | *(fill in during the live run)* | | |
