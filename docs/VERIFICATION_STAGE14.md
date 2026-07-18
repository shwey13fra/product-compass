# Stage 14 — Verification: experience sync + anonymous→auth claim

> **Purpose.** Prove the Stage 14 claims against the real project (prod URL, not
> localhost):
>
> 1. **`experience_profiles` is invisible to the client** — deny-all RLS; an
>    owner_key can only touch its own row, and only through the RPCs. No enumeration.
> 2. **Anonymous experience persists to Supabase** under `compass_uid` and survives
>    a reload; **newest-wins** — a stale push can't clobber a newer row.
> 3. **First sign-in claims** this device's anonymous `applications` /
>    `brief_feedback` / `events` / `ai_usage` / `experience` onto the auth id; the
>    toast shows **once**; re-running is a **no-op** (idempotent); `/tracking` still
>    lists the apps (no silent-empty).
> 4. **The fully anonymous flow is unchanged** — a user who never signs in notices
>    nothing except cross-reload durability.
> 5. **No new PII** — `events`/`errors` still carry only ids/enums/booleans.
>
> **Run status: ⬜ NOT RUN.** Local `npm run build` passes (TypeScript + static
> generation clean). Nothing below may be marked ✅ until its output appears here —
> pasted by the user or returned by a tool call (PAST_MISTAKES 2026-07-16 rule).

---

## 0. Setup — the user must do this first

1. **Run the migration.** Paste `scripts/stage14-experience-sync-and-claim.sql`
   into the Supabase SQL editor and run it. Expected: `Success. No rows returned.`
2. **Deploy the app code** (commit + push → Vercel) so the new client actually
   talks to the RPCs. **No new env vars** — this stage spends nothing.

> **Stage 11 lesson:** migration + deploy are **one atomic change** and dev/prod
> share one Supabase project. This migration is **additive and backward-compatible**
> (new table + functions; no policy dropped; no data moves until the deployed code
> calls `claim_anonymous_data`), so running it before the deploy causes no
> silent-empty window — but the stage is not done until **both** are live and
> verified against the **production URL**.

---

## a. Isolation — three legs ⬜ NOT RUN

**The control is what makes `[]` mean anything** (PAST_MISTAKES: an empty result
only proves denial if you separately prove the rows exist). Run from a terminal,
**not** the SQL editor (service-role bypasses the very thing under test). First
seed one known row via the app path (leg c writes it), then attack it.

```powershell
cd C:\Users\shwet\Product_compass
$URL = ((Get-Content .env.local | Where-Object { $_ -like 'NEXT_PUBLIC_SUPABASE_URL=*' }) -split '=',2)[1].Trim()
$KEY = ((Get-Content .env.local | Where-Object { $_ -like 'NEXT_PUBLIC_SUPABASE_ANON_KEY=*' }) -split '=',2)[1].Trim()
$H = @{ apikey = $KEY; Authorization = "Bearer $KEY"; 'Content-Type' = 'application/json' }
$OWNER = 'verify-stage14-' + [guid]::NewGuid().ToString()

# leg (c) APP PATH — write via the RPC (this is the only legal door), then read it back.
Invoke-RestMethod -Method Post -Uri "$URL/rest/v1/rpc/upsert_experience" -Headers $H `
  -Body (@{ p_owner=$OWNER; p_payload=@{ version=1; name='V'; headline='h'; experience='x'; archetype=$null; updatedAt=(Get-Date).ToUniversalTime().ToString('o') }; p_updated_at=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Depth 5)
Invoke-RestMethod -Method Post -Uri "$URL/rest/v1/rpc/get_experience" -Headers $H `
  -Body (@{ p_owner=$OWNER } | ConvertTo-Json -Depth 5)          # EXPECT: one row (the profile)

# leg (a) CONTROL — the anon key works at all (public table returns rows).
(Invoke-RestMethod -Method Get -Uri "$URL/rest/v1/roles?select=id&limit=1" -Headers $H).Length  # EXPECT: 1

# leg (b) ATTACK — direct table read with the anon key, targeting the KNOWN owner.
Invoke-RestMethod -Method Get -Uri "$URL/rest/v1/experience_profiles?owner_key=eq.$OWNER&select=*" -Headers $H
#   EXPECT: []  (deny-all RLS — the row exists per leg c, but the anon client cannot see it)
```

**Paste the three outputs here.** Pass = (a) returns 1, (b) returns `[]` for a row
that (c) proved exists and can be read via the RPC. ⬜

---

## b. Anonymous sync + newest-wins ⬜ NOT RUN

1. **Sync.** Fresh browser (or a new profile) on the prod URL → open a role →
   **My experience** → fill + Save. In the Supabase SQL editor:
   `select owner_key, updated_at from experience_profiles order by updated_at desc limit 3;`
   → EXPECT a row whose `owner_key` equals this browser's `compass_uid`
   (`localStorage.getItem('compass_uid')` in the console). ⬜
2. **Durability.** Reload the page → the experience text is still there. ⬜
3. **Newest-wins (RPC guard).** From the terminal in §a's session, push an **older**
   timestamp for `$OWNER` and confirm it does **not** overwrite:
   ```powershell
   Invoke-RestMethod -Method Post -Uri "$URL/rest/v1/rpc/upsert_experience" -Headers $H `
     -Body (@{ p_owner=$OWNER; p_payload=@{ version=1; name='STALE'; headline='h'; experience='old'; archetype=$null; updatedAt='2000-01-01T00:00:00.000Z' }; p_updated_at='2000-01-01T00:00:00.000Z' } | ConvertTo-Json -Depth 5)
   ```
   → EXPECT the returned row still shows `name='V'` (the newer payload), not `STALE`. ⬜

---

## c. Claim on first sign-in ⬜ NOT RUN

Pre-state: while **signed out**, apply to ≥1 role and fill experience (data lands
under `compass_uid`). Note that `compass_uid` from the console.

1. **Sign in** (magic link / OTP). EXPECT the toast **“Your saved work has been
   linked to your account.”** exactly once. ⬜
2. **Re-key landed.** In the SQL editor, with `<AUTH_ID>` = the signed-in user id
   (`select id,email from auth.users where email='<you>';`) and `<UID>` = the noted
   `compass_uid`:
   ```sql
   select 'apps_auth'   k, count(*) from applications        where owner_key='<AUTH_ID>'
   union all select 'apps_anon', count(*) from applications  where owner_key='<UID>'
   union all select 'exp_auth',  count(*) from experience_profiles where owner_key='<AUTH_ID>'
   union all select 'exp_anon',  count(*) from experience_profiles where owner_key='<UID>';
   ```
   → EXPECT the `_auth` rows > 0 and the `_anon` rows = 0. ⬜
3. **`/tracking` still lists the apps** after sign-in (no silent-empty — reads now
   resolve owner to the auth id). ⬜
4. **Idempotent.** Reload / navigate while still signed in → **no** second toast
   (the `compass_claimed:<AUTH_ID>` localStorage flag + the now-empty anon rows
   from §c2 are the proof). Note: you can **not** re-test the RPC from the SQL
   editor — it runs as service-role where `auth.uid()` is null, so
   `claim_anonymous_data` raises `must be signed in`; that raise is itself the
   guard working. The real idempotency evidence is §c2's `_anon = 0` plus no
   repeat toast. ⬜
5. **Quota summed (no free quota).** If the anon identity had `ai_usage` this month,
   `select identity, period, count from ai_usage where identity='<AUTH_ID>';` shows
   the anon count folded in, and the `<UID>` row is gone. ⬜

---

## d. Regression — anonymous flow unchanged ⬜ NOT RUN

In a browser that **never signs in**: browse roles → generate a brief (live or
manual) → Mark as Applied → status strip + follow-up nudge all work exactly as
before. The only new behavior is that the experience survives a reload from the
server copy. `resolveOwnerKey()` returns the `compass_uid` for this user (no
session), so every owner-scoped read/write is byte-for-byte the pre-Stage-14 path. ⬜

---

## e. No new PII ⬜ NOT RUN

`experience_profiles.payload` holds the profile object **by design** — it is
owner-scoped and deny-all (only the owner's own RPC call reads it), never expanded
into analytics. Confirm nothing new leaked into the open tables:
`select name, props from events order by created_at desc limit 20;` →
EXPECT props are still ids/enums/booleans only (no name/headline/experience text). ⬜

---

## Verdict

⬜ **NOT RUN** — awaiting migration + prod deploy, then the sections above.
Local build is green. Do not mark any section ✅ from expectation; only from output
pasted here or returned by a tool call.
