-- Product Compass — Stage 11: durable AI quota + IP rate limit + real RLS
-- isolation for the anonymous applications table. Run ONCE in the Supabase SQL
-- editor (service role → bypasses RLS). Idempotent: safe to re-run.
--
-- SECURITY RULE (unchanged): anon key only, NEVER service-role. Enforcement here
-- is done with SECURITY DEFINER functions + RLS, so the public anon client can
-- never race, spoof, or enumerate.
--
-- ⚠️ RUN THIS BEFORE (or together with) deploying the Stage 11 app code. The app
-- now reads/writes `applications` ONLY through the functions below; until they
-- exist, anonymous tracking will error (safe — no data leak).

-- ============================================================================
-- 1) ai_usage — durable per-identity monthly counter (replaces the old
--    per-process in-memory cap, which reset on every cold start).
--    identity = auth user id when signed in, else compass_uid.
-- ============================================================================
create table if not exists public.ai_usage (
  identity    text not null,
  period      text not null,                          -- 'YYYY-MM'
  count       int  not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (identity, period)
);

alter table public.ai_usage enable row level security;
-- No policies → the anon/authenticated client can NEVER touch this table
-- directly. Access is only through increment_ai_usage() (SECURITY DEFINER).

-- Atomically bump the counter for (identity, current month) and report whether
-- the call is allowed under p_limit. Only increments when ALLOWED, so a denied
-- call doesn't keep inflating the count and `remaining` stays accurate.
create or replace function public.increment_ai_usage(p_identity text, p_limit int)
returns table(allowed boolean, used int, remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := to_char(now(), 'YYYY-MM');
  v_count  int;
begin
  if coalesce(p_identity, '') = '' then
    -- No identity → treat as denied rather than metering a global bucket.
    return query select false, 0, 0;
    return;
  end if;

  insert into public.ai_usage (identity, period, count)
       values (p_identity, v_period, 0)
  on conflict (identity, period) do nothing;

  -- Lock this identity's row for the duration of the txn (no race between
  -- concurrent requests from the same identity).
  select count into v_count
    from public.ai_usage
   where identity = p_identity and period = v_period
   for update;

  if v_count >= p_limit then
    return query select false, v_count, 0;
  else
    update public.ai_usage
       set count = count + 1, updated_at = now()
     where identity = p_identity and period = v_period;
    return query select true, v_count + 1, greatest(0, p_limit - (v_count + 1));
  end if;
end;
$$;

-- ============================================================================
-- 2) ip_rate_limits — coarse fixed-window IP backstop. Catches compass_uid
--    rotation (clearing localStorage to get a fresh quota): the identity resets
--    but the IP doesn't. Window = one clock hour.
-- ============================================================================
create table if not exists public.ip_rate_limits (
  ip          text not null,
  window_key  text not null,                          -- 'YYYY-MM-DD-HH24'
  count       int  not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (ip, window_key)
);

alter table public.ip_rate_limits enable row level security;
-- No policies → direct access denied; only check_ip_rate() (definer) touches it.

create or replace function public.check_ip_rate(p_ip text, p_limit int)
returns table(allowed boolean, used int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window text := to_char(now(), 'YYYY-MM-DD-HH24');
  v_count  int;
begin
  if coalesce(p_ip, '') = '' then
    -- Unknown IP (e.g. local dev with no x-forwarded-for) → don't block.
    return query select true, 0;
    return;
  end if;

  insert into public.ip_rate_limits (ip, window_key, count)
       values (p_ip, v_window, 0)
  on conflict (ip, window_key) do nothing;

  select count into v_count
    from public.ip_rate_limits
   where ip = p_ip and window_key = v_window
   for update;

  if v_count >= p_limit then
    return query select false, v_count;
  else
    update public.ip_rate_limits
       set count = count + 1, updated_at = now()
     where ip = p_ip and window_key = v_window;
    return query select true, v_count + 1;
  end if;
end;
$$;

-- ============================================================================
-- 3) applications — swap PERMISSIVE policies for REAL isolation.
--    RLS stays ON but we DROP every policy → direct table access by anon/
--    authenticated is fully denied. All reads/writes go through the SECURITY
--    DEFINER functions below, each of which REQUIRES the caller to present the
--    exact owner_key (a secret UUID). No function lists owner_keys, so
--    enumeration is impossible: you can only touch rows whose uid you hold.
-- ============================================================================
drop policy if exists "applications anon select" on public.applications;
drop policy if exists "applications anon insert" on public.applications;
drop policy if exists "applications anon update" on public.applications;
drop policy if exists "applications anon delete" on public.applications;
-- (RLS remains enabled from stage 5; with no policies it is now deny-all.)
alter table public.applications enable row level security;

create or replace function public.get_applications(p_uid text)
returns setof public.applications
language sql
security definer
set search_path = public
stable
as $$
  select * from public.applications
   where owner_key = p_uid
   order by updated_at desc;
$$;

create or replace function public.get_application(p_uid text, p_role text)
returns setof public.applications
language sql
security definer
set search_path = public
stable
as $$
  select * from public.applications
   where owner_key = p_uid and role_id = p_role
   limit 1;
$$;

-- Upsert status for (owner_key, role_id). Re-stamps status_changed_at + updated_at
-- so the follow-up nudge measures time since the last change.
create or replace function public.upsert_application(p_uid text, p_role text, p_status text)
returns setof public.applications
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.applications (owner_key, role_id, status, status_changed_at, updated_at)
       values (p_uid, p_role, p_status, now(), now())
  on conflict (owner_key, role_id) do update
     set status = excluded.status,
         status_changed_at = excluded.status_changed_at,
         updated_at = excluded.updated_at
  returning *;
end;
$$;

-- Demo affordance: shift status_changed_at back by p_days (keeps status +
-- updated_at, so list order is stable) → the time-based "Seen" nudge appears
-- without waiting real days.
create or replace function public.backdate_application(p_uid text, p_role text, p_days int)
returns setof public.applications
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.applications
     set status_changed_at = status_changed_at - make_interval(days => p_days)
   where owner_key = p_uid and role_id = p_role
  returning *;
end;
$$;

-- ============================================================================
-- 4) Grants — the anon (and signed-in) client may EXECUTE these functions, but
--    has no direct table rights that RLS would honor. Definer functions run as
--    their owner (bypassing RLS) so they can read/write the locked tables.
-- ============================================================================
grant execute on function public.increment_ai_usage(text, int) to anon, authenticated;
grant execute on function public.check_ip_rate(text, int)      to anon, authenticated;
grant execute on function public.get_applications(text)                 to anon, authenticated;
grant execute on function public.get_application(text, text)            to anon, authenticated;
grant execute on function public.upsert_application(text, text, text)   to anon, authenticated;
grant execute on function public.backdate_application(text, text, int)  to anon, authenticated;

-- ============================================================================
-- Done. Env (optional, defaults shown): AI_MONTHLY_LIMIT=15,
-- AI_IP_HOURLY_LIMIT=10 on the server (Vercel). // TODO(v2): sliding-window
-- rate limiting + periodic cleanup of old ip_rate_limits/ai_usage rows.
-- ============================================================================
