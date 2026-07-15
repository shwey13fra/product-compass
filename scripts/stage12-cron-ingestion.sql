-- Product Compass — Stage 12: daily cron ingestion.
-- Run ONCE in the Supabase SQL editor (service role → bypasses RLS). Idempotent.
--
-- SECURITY RULE (unchanged): anon key only, NEVER service-role. The cron writes
-- as a dedicated Supabase auth BOT USER whose JWT is forwarded to the existing
-- pipeline — NOT via a SECURITY DEFINER function granted to anon.
--
--   WHY NOT A DEFINER FUNCTION: the cron has no admin JWT, and service-role is
--   banned, so such a function would have to be granted to `anon`. The anon key
--   is PUBLIC (it ships in the browser bundle) → the function would be callable
--   by anyone, and SECURITY DEFINER bypasses the roles admin-write RLS by design.
--   A CRON_SECRET check in the route is no defence: an attacker POSTs straight to
--   /rest/v1/rpc/... and never touches Next.js. Proven in session 12 — a terminal
--   curl with only the anon key successfully called rpc/get_applications.
--   If this is ever revisited, the secret MUST be an argument the function itself
--   verifies (as the Stage 11 uid-bearer RPCs do).
--
-- ⚠️ Additive and backward-compatible: only ADDS a predicate, WIDENS the roles
-- write policies, and creates a new table. Safe to run before deploying the code.
-- Stage 11 lesson still applies: the stage is not done until migration AND deploy
-- are both live and verified against the PRODUCTION url, not localhost.
--
-- PREREQ: create the bot user FIRST (Supabase → Authentication → Users → Add user,
-- "Auto Confirm User" ON), then replace BOT_EMAIL_HERE below with its email and
-- set the same value in the INGEST_BOT_EMAIL env var.

-- ============================================================================
-- 1) is_ingest_bot() — least privilege. Mirrors is_admin()'s shape (stage7:20-35)
--    but grants ONLY roles writes. Deliberately NOT folded into is_admin(): that
--    would make a leaked bot password full admin AT THE DATA LAYER (read
--    referral_applications, override statuses), because ADMIN_EMAILS in
--    src/config.ts drives only the UI while RLS is the real gate.
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
-- 2) roles — widen the admin-only write policies (stage7:93-99) to admin-OR-bot.
--    Policy names below are the REAL ones from stage7-auth-referrals.sql.
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

-- "roles admin delete" (stage7:101-103) is LEFT UNTOUCHED — admin-only.
-- The bot never deletes: expiry flips is_live=false and keeps history.

-- ============================================================================
-- 3) sync_runs — one row per source per run, grouped by run_id. Admin-readable,
--    NEVER client-readable (it names companies and failure modes). anon gets no
--    policy → deny-all, same pattern as ai_usage in stage 11.
-- ============================================================================
create table if not exists public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null,                       -- groups the per-source rows of one run
  run_at      timestamptz not null default now(),
  trigger     text not null,                       -- 'cron' | 'manual'
  source      text not null,                       -- 'greenhouse' | 'lever' | 'adzuna'
  fetched     int  not null default 0,             -- PM jobs after filter, before dedupe
  inserted    int  not null default 0,
  updated     int  not null default 0,
  expired     int  not null default 0,
  ok          boolean not null default true,       -- false if this source errored
  errors      text[] not null default '{}',
  warnings    text[] not null default '{}'         -- e.g. the expiry circuit breaker
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
-- Done. Env (server-side, Vercel + .env.local): CRON_SECRET, INGEST_BOT_EMAIL,
-- INGEST_BOT_PASSWORD. // TODO(v2): retention/cleanup for old sync_runs rows.
-- ============================================================================
