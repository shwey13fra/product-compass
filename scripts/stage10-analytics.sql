-- Product Compass — Stage 10: first-party instrumentation (events + errors).
-- Run ONCE in the Supabase SQL editor (service role → bypasses RLS). Idempotent.
--
-- DESIGN:
--   * Two INSERT-only tables. The client (anon key) can INSERT but has NO
--     SELECT/UPDATE/DELETE policy → RLS default-deny means reads are impossible
--     from the browser. You read them ONLY here in the dashboard/SQL editor
--     (service role bypasses RLS). This is the zero-cost, no-paid-tool analytics.
--   * NO PII is stored: props/detail carry ids, enums, booleans, counts — never
--     emails or experience text (enforced in lib/analytics.ts + code review).
--   * `uid` = the anonymous compass_uid (localStorage). `user_id` = the Supabase
--     auth id when signed in, else null. Neither is PII on its own.
--
-- SECURITY NOTE (v1): anyone with the public anon key can INSERT rows here (same
-- tradeoff as the applications table). That's acceptable because nothing
-- sensitive is stored and the data is analytics-only. // TODO(v2): a rate limit
-- or an edge function with a shared secret if spam becomes a problem.

-- ============================================================================
-- 1) events — product analytics
-- ============================================================================
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  uid         text,                                   -- anonymous compass_uid
  user_id     uuid,                                   -- auth user id or null
  name        text not null,                          -- event name (docs/METRICS.md)
  props       jsonb not null default '{}'::jsonb      -- ids/enums/booleans only
);

create index if not exists events_name_created_idx on public.events (name, created_at desc);
create index if not exists events_uid_created_idx   on public.events (uid, created_at desc);

alter table public.events enable row level security;

-- INSERT-only for the browser client (anon + signed-in). No other policies →
-- SELECT/UPDATE/DELETE are denied for anon/authenticated.
drop policy if exists "events insert client" on public.events;
create policy "events insert client" on public.events
  for insert to anon, authenticated with check (true);

-- ============================================================================
-- 2) errors — server-side error log (our zero-cost alternative to Sentry)
-- ============================================================================
create table if not exists public.errors (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  source      text not null,                          -- e.g. 'api/position'
  message     text not null,                          -- sanitized; never a secret
  detail      jsonb not null default '{}'::jsonb,     -- status codes, flags — no PII
  uid         text,
  user_id     uuid
);

create index if not exists errors_source_created_idx on public.errors (source, created_at desc);

alter table public.errors enable row level security;

-- The /api/position route logs failures server-side via the anon client, so
-- allow INSERT for anon/authenticated. No read policy → dashboard-only reads.
drop policy if exists "errors insert client" on public.errors;
create policy "errors insert client" on public.errors
  for insert to anon, authenticated with check (true);

-- ============================================================================
-- Done. See docs/METRICS.md for the event dictionary and the SQL that computes
-- the three provisional targets.
-- ============================================================================
