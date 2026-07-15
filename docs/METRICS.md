# Metrics & Instrumentation — Product Compass

Stage 10 first-party instrumentation. **Zero-cost, no paid analytics tools, no
PII.** Events land in the Supabase `events` table; server errors in `errors`
(both INSERT-only from the client — see `scripts/stage10-analytics.sql`). Reads
happen **only** in the Supabase dashboard / SQL editor (service role). Page-level
traffic is covered separately by **Vercel Analytics** (free tier), wired in
`src/app/layout.tsx`.

## Design decisions

- **Error monitoring = a server-side `errors` table, not Sentry.** Sentry's free
  tier exists but adds a heavy client SDK + another external service + a DSN. We
  already have the exact insert-only Supabase pattern, so an `errors` table adds
  **zero client bundle**, keeps everything queryable in one place, and captures
  the one thing that matters most — **`/api/position` (Anthropic) failures** —
  server-side where we control the catch blocks. Tradeoff: unhandled *browser*
  exceptions aren't auto-captured (Sentry's strength). Acceptable for v1;
  `// TODO(v2)` add Sentry if client-side crash visibility becomes necessary.
- **`track()` is fire-and-forget and never throws** (`src/lib/analytics.ts`) —
  instrumentation must never block or break a user flow.
- **No PII, enforced by convention + review:** props carry only ids, enums,
  booleans, and counts. Never emails, names, JD/experience text, or brief/message
  contents. `uid` (anonymous compass_uid) and `user_id` (auth id) are not PII.

## Event dictionary

Every event carries `uid` (anon compass_uid), `user_id` (auth id or null),
`created_at`, and `name` automatically. The `props` column below is the extra payload.

| Event | Fires when | `props` | Fired from |
|-------|-----------|---------|-----------|
| `role_viewed` | A role detail page mounts | `{ role_id }` | `TrackEvent` in `roles/[id]/page.tsx` |
| `fit_read_shown` | The fit-read panel first becomes visible for a role | `{ role_id }` | `PositioningPanel` |
| `brief_generated` | A brief is produced | `{ mode: "live" \| "manual", role_id }` | `PositioningPanel` (live call success / manual parse success) |
| `brief_copied` | The **Copy brief** button is used | `{ role_id }` | `PositioningPanel` → `BriefView` |
| `applied` | A role is marked applied (anonymous **or** referral) | `{ role_id, had_brief: boolean }` | `ApplyButton`, `ReferralApplyButton` |
| `status_changed` | A tracking/referral status advances | `{ from, to }` | `TrackingCard`, `referrals/[id]` |
| `nudge_shown` | The follow-up nudge first appears on a tracked card | `{ role_id }` | `TrackingCard` |
| `referral_thread_message` | A message is posted in a referral thread | `{ role_id }` (never the body) | `referrals/[id]` |
| `onboarding_completed` | The onboarding questionnaire is saved | — | `OnboardingModal` |
| `sign_in` | OTP verification succeeds | — (never the email) | `signin` page |

> **`had_brief` is the key field.** It records whether a positioning brief
> already existed (localStorage) at the moment of applying — the whole point of
> the product. It powers target (a).

### `errors` table

| Column | Meaning |
|--------|---------|
| `source` | e.g. `api/position` |
| `message` | short, sanitized (never a secret) |
| `detail` | jsonb — status codes / flags only (never the API key, request body, or model output) |

`/api/position` logs: missing key, network failure, non-ok Anthropic status
(`{ status }`), model refusal, and unparseable output (`{ reason }` — the
parser's reason, **not** the model text).

---

## The three provisional targets (SQL)

Run these in the Supabase SQL editor. Windows use 7 days; adjust as needed.

### (a) % of applications sent with a brief — target **≥ 60%**

```sql
-- Of all applications, what share had a brief ready at apply time?
select
  count(*)                                              as applications,
  count(*) filter (where (props->>'had_brief')::boolean) as with_brief,
  round(
    100.0 * count(*) filter (where (props->>'had_brief')::boolean)
    / nullif(count(*), 0)
  , 1)                                                  as pct_with_brief
from public.events
where name = 'applied';
-- PASS when pct_with_brief >= 60.
```

### (b) Briefs per weekly active user — provisional target **≥ 1.0**

```sql
-- WAU = distinct uids with ANY event in the last 7 days.
-- Numerator = briefs generated in the same window.
with w as (
  select * from public.events
  where created_at >= now() - interval '7 days'
)
select
  (select count(*) from w where name = 'brief_generated')          as briefs_7d,
  (select count(distinct uid) from w)                              as wau,
  round(
    (select count(*) from w where name = 'brief_generated')::numeric
    / nullif((select count(distinct uid) from w), 0)
  , 2)                                                             as briefs_per_wau;
```

### (c) Error rate on `/api/position` — target **< 2%**

```sql
-- Failures (errors table) vs total live attempts (failures + successful live
-- brief_generated) over the last 7 days.
with e as (
  select count(*) c from public.errors
  where source = 'api/position' and created_at >= now() - interval '7 days'
),
s as (
  select count(*) c from public.events
  where name = 'brief_generated'
    and props->>'mode' = 'live'
    and created_at >= now() - interval '7 days'
)
select
  e.c                                              as errors_7d,
  s.c                                              as live_successes_7d,
  round(100.0 * e.c / nullif(e.c + s.c, 0), 2)     as error_rate_pct
from e, s;
-- PASS when error_rate_pct < 2.
```

## How to test the instrumentation

1. Run `scripts/stage10-analytics.sql` in Supabase (one-time).
2. `npm run dev`, walk the core flow (view a role → fit read → generate/copy a
   brief → apply → advance status → nudge).
3. In the Supabase SQL editor: `select name, props, created_at from public.events
   order by created_at desc limit 30;` — confirm the events appear and **no props
   contain an email or free text**.
4. Force an `/api/position` failure (e.g. temporarily bad key) → confirm a row in
   `errors` with only a status/flag in `detail`.
