# Stage 11 — Verification: durable AI quota + real RLS isolation

> **Purpose.** Prove the two Stage 11 claims against the real Supabase project,
> after `scripts/stage11-ai-quota-and-rls.sql` has been run:
>
> 1. **Budget is durable** — the €5 credit can't be drained. A monthly quota per
>    identity refuses the run past the limit, a refused run costs nothing, and the
>    manual paste-in stays free and unlimited.
> 2. **Isolation is real** — `applications` is RLS deny-all. The anon key cannot
>    read the table directly even knowing an exact `owner_key`; the app works only
>    through `SECURITY DEFINER` RPCs.
>
> **Run status: ✅ PASSED — 2026-07-15 (session 12).** Evidence below.

---

## 0. Setup — read this first, it's where the last run went wrong

**The quota identity is not "you". It's resolved per request** by
`resolveIdentity()` in `src/app/api/position/route.ts`, in this order:

1. **Verified Supabase auth user id** — if you're signed in (`Authorization: Bearer`)
2. else **`compass_uid`** — the `x-compass-uid` header, read from `localStorage`
3. else **`ip:<addr>`** — so metering always happens

Two consequences that will waste your time and credit if you miss them:

- **`localStorage` is per origin.** `localhost:3000` and
  `product-compass-lilac.vercel.app` hold **different** `compass_uid`s. They are
  different quota buckets. Seeding one does nothing to the other.
- **Signing in switches you to a third bucket** (the auth user id), because the
  route prefers the id that can't be spoofed.

> **Do not guess the identity — read it back from the DB.** After any live run,
> `select identity, count from ai_usage order by updated_at desc` shows the exact
> bucket that was metered. Seed *that* value.

Also: **your experience must be saved** before testing the quota. An empty
experience returns a validation 400 *before* the quota check, so the test never
runs and it looks like a failure.

Where each command goes:

| Command | Where | Why |
|---|---|---|
| `select …` / `insert …` | Supabase **SQL editor** | Runs as service role — **bypasses RLS**, so useless for testing isolation |
| `localStorage.getItem('compass_uid')` | Browser **F12 → Console** | It's JavaScript, not SQL |
| `curl.exe …` | A **separate PowerShell window** | Uses the anon key = the real client's privileges. Does *not* need `npm run dev` — it hits Supabase directly |

---

## a. Durable monthly quota refuses past the limit

Don't burn 15 real calls (~€0.045) to reach the limit — pre-load the counter.

| # | Action | Expected |
|---|--------|----------|
| a1 | Do one live **Position me** so the route creates your row, then `select identity, period, count, updated_at from ai_usage order by updated_at desc;` | A row with `count = 1`. **This identity is the bucket to seed** — copy it. |
| a2 | `update ai_usage set count = 15 where identity = '<that identity>' and period = to_char(now(),'YYYY-MM');` then re-select | `count = 15` against that identity |
| a3 | Same browser/tab → any role → **Position me** | Refusal: *"You've used all 15 live positionings this month. The manual paste-in is free and unlimited…"* Caption under the buttons flips to *"Live positioning is used up this month…"* |
| a4 | Re-run the select | **`count` is still 15, not 16** — a denied call doesn't inflate the counter, so `remaining` stays honest |
| a5 | Click **Paste it in manually** | The Stage-3 prompt/paste-back flow still works — refused ≠ blocked, zero credit |
| a6 | Cleanup: `delete from ai_usage where identity = '<that identity>';` | Quota restored |

**Result 2026-07-15: ✅ PASSED.** Refusal fired with the friendly message, manual
fallback worked, counter held at 15. Tested while **signed in**, so this also
proves the **auth-user-id branch** of `resolveIdentity` (not just `compass_uid`).

---

## b. `applications` is genuinely deny-all (the anon-key proof)

**This must run outside the SQL editor.** The editor is service-role and bypasses
RLS — it would show rows and prove nothing.

```powershell
$env  = Get-Content "C:\Users\shwet\Product_compass\.env.local"
$anon = (($env | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' }) -replace '^NEXT_PUBLIC_SUPABASE_ANON_KEY=','').Trim().Trim('"')
$url  = (($env | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_URL=' })      -replace '^NEXT_PUBLIC_SUPABASE_URL=','').Trim().Trim('"').TrimEnd('/')
$uid  = '<a real owner_key from: select owner_key from applications limit 1>'
$headers = @{ apikey = $anon; Authorization = "Bearer $anon" }

# CONTROL — the key works at all (roles has a public SELECT policy)
curl.exe -s "$url/rest/v1/roles?select=id,title&limit=2" -H "apikey: $anon" -H "Authorization: Bearer $anon"

# ATTACK — direct table read, already knowing the exact owner_key
curl.exe -s "$url/rest/v1/applications?select=*&owner_key=eq.$uid" -H "apikey: $anon" -H "Authorization: Bearer $anon"

# ATTACK — the quota table (can a client reset its own counter?)
curl.exe -s "$url/rest/v1/ai_usage?select=*" -H "apikey: $anon" -H "Authorization: Bearer $anon"

# APP PATH — same anon key, through the SECURITY DEFINER rpc
Invoke-RestMethod -Method Post -Uri "$url/rest/v1/rpc/get_applications" -Headers $headers `
  -ContentType "application/json" -Body (@{ p_uid = $uid } | ConvertTo-Json)
```

| # | Request | Expected | **Actual 2026-07-15** |
|---|---------|----------|----------------------|
| b1 | `roles?select=id,title&limit=2` | rows (control) | ✅ 2 rows, HTTP 200 — key valid, so no false negatives below |
| b2 | `applications?owner_key=eq.<known uid>` | `[]` | ✅ `[]`, HTTP 200 — **denied even knowing the exact owner_key** |
| b3 | `ai_usage?select=*` | `[]` | ✅ `[]`, HTTP 200 — client can't read or reset its own quota |
| b4 | `rpc/get_applications` with that uid | the rows | ✅ **6 rows** (`seen`, `shared_with_hm`, `applied`, `closed`) |

> **b4 is what makes b2 mean something.** The rows demonstrably exist — so the
> `[]` in b2 is RLS actively refusing, not an empty table. Same key, same uid:
> direct = denied, RPC = allowed. `SECURITY DEFINER` is the only door.

**Result: ✅ PASSED.** Also incidentally proves the **read** path
(`get_applications`) works — the Mark-as-Applied test only covered the write.

### The security property, stated precisely (for the PRD/portfolio)

Enumeration is impossible because **no function ever lists `owner_key`s** — every
RPC requires the caller to present the exact uid. You can only touch rows whose
uid you already hold.

The uid is therefore a **bearer secret**: anyone who obtains it can read that
tracker. For role-status data with no PII in a no-auth v1 this is the right
trade, and it is a genuine improvement over Stage 5 (client-side *filtering*, not
isolation). // TODO(v2): fold the anonymous tracker into Supabase Auth so
isolation is identity-based rather than uid-bearer-based.

---

## c. Tracking flow still works after the RPC swap

`applications` went deny-all in Stage 11, so every read/write now goes through the
RPCs — the Stage 5 flow has to be re-confirmed.

| # | Action | Expected | Actual |
|---|--------|----------|--------|
> **`/tracking` is the anonymous track — sign-in is irrelevant to it.** It is keyed
> by `compass_uid`, never by the auth user. But `compass_uid` is **per origin**, so
> an empty tracker on the lilac URL after testing on `localhost:3000` is *expected*,
> not a regression. Judge prod by a **fresh Apply → view → reload** round-trip, not
> by whether old rows appear.

| c1 | Role → **Mark as Applied** | Green **Tracking · Applied** pill | ✅ (write path via `upsert_application`) |
| c2 | `/tracking` → card listed | Real card, not empty state | ✅ |
| c3 | Click **Seen** → **reload** | Still Seen (read path via `get_applications`) | ✅ evidenced by b4 (6 persisted rows incl. `seen`, `shared_with_hm`) |
| c4 | At Seen → **Demo: simulate a week passing** → nudge → reload | Nudge persists | ✅ evidenced by b4: a row with `status_changed_at` 2026-07-01 vs `updated_at` 2026-07-15 = `backdate_application` persisting |
| c5 | **Closed** → confirm | Similar live roles section | ⬜ UI click-through outstanding (data path proven; rendering only) |

---

## d. Validation 400s consume nothing

Not re-run this session — verified in session 11 **pre-migration**, and no code on
that path has changed since. All four validation 400s (bad JSON, missing role
fields, empty experience, missing key) return before `increment_ai_usage` is ever
called, so they can't spend quota or credit.

To re-check: note `count`, POST `/api/position` with `{"profile":{"experience":""}}`,
expect HTTP 400 + `count` unchanged.

---

## Bugs found

| Step | What happened | Expected | Severity |
|------|---------------|----------|----------|
| a1 | Seeded the uid from `applications.owner_key` — a **`compass_uid`** — but was **signed in**, so the route metered the **verified auth user id** instead. Different namespaces; the seed could never fire. Quota didn't refuse; a real live call ran (~€0.003). | Refusal | **Not a code bug** — test-method error. `increment_ai_usage` was correct throughout: `ai_usage` grew a *second* row under the auth id at `count = 1`. Fixed by reading the metered identity back and seeding that. Recorded in `PAST_MISTAKES.md`. |

## Parked (not Stage 11)

- **Fit read shows `10% rough match` / "Nothing detected yet"** on a role while the
  generated brief underneath is detailed and specific about the same experience.
  Those contradict — suspect `computeFitRead` failing to match the experience text
  against JD themes. Investigate in `src/lib/positioning.ts`.
</content>
</invoke>
