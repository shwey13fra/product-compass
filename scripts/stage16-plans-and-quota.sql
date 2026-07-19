-- Product Compass — Stage 16: Free/Pro plans + plan-based AI quota + WTP signal.
-- Run ONCE in the Supabase SQL editor (service role → bypasses RLS). Idempotent:
-- safe to re-run. Run AFTER stage7-auth-referrals.sql and stage11-ai-quota-and-rls.sql.
--
-- SECURITY RULE (unchanged): anon key only, NEVER service-role in the app. Plans are
-- read/written only through SECURITY DEFINER functions; the app never trusts a
-- client-supplied identity for the PLAN (see the server: plan is derived from the
-- VERIFIED auth token, never from compass_uid).

-- ============================================================================
-- 1) profiles.plan — free (default) | pro. Admin-set only (no self-serve upgrade
--    in this stage). Anonymous users have no profile row → treated as free.
-- ============================================================================
alter table public.profiles
  add column if not exists plan text not null default 'free'
  check (plan in ('free', 'pro'));

-- ============================================================================
-- 2) get_ai_usage — READ-ONLY current-month count for an identity. Powers the
--    pre-click quota indicator without spending a call (never increments).
--    identity = verified auth user id when signed in, else compass_uid, else ip:*
-- ============================================================================
create or replace function public.get_ai_usage(p_identity text)
returns table(used int)
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select count
       from public.ai_usage
      where identity = p_identity
        and period = to_char(now(), 'YYYY-MM')),
    0
  );
$$;

-- ============================================================================
-- 3) increment_ai_usage — extend to support UNLIMITED (Pro). p_limit < 0 ⇒
--    always allowed, still increments (so Pro usage is measured for the budget),
--    remaining returns -1 as the "unlimited" sentinel. p_limit >= 0 unchanged.
-- ============================================================================
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
    -- No identity → denied rather than metering a global bucket.
    return query select false, 0, 0;
    return;
  end if;

  insert into public.ai_usage (identity, period, count)
       values (p_identity, v_period, 0)
  on conflict (identity, period) do nothing;

  select count into v_count
    from public.ai_usage
   where identity = p_identity and period = v_period
   for update;

  -- Unlimited (Pro): always allow, still increment so usage stays measured.
  if p_limit < 0 then
    update public.ai_usage
       set count = count + 1, updated_at = now()
     where identity = p_identity and period = v_period;
    return query select true, v_count + 1, -1;
    return;
  end if;

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
-- 4) admin_set_plan — flip a user's plan by email. Admin-only, enforced IN
--    POSTGRES via is_admin() (not just the UI). Returns rows affected (0 = no
--    such signed-in user; they must sign in once to get a profile row).
-- ============================================================================
create or replace function public.admin_set_plan(p_email text, p_plan text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  if p_plan not in ('free', 'pro') then
    raise exception 'invalid plan';
  end if;

  update public.profiles
     set plan = p_plan
   where email = lower(trim(p_email));

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ============================================================================
-- 5) Grants — clients may EXECUTE these; direct table access stays RLS-governed.
-- ============================================================================
grant execute on function public.get_ai_usage(text)          to anon, authenticated;
grant execute on function public.increment_ai_usage(text, int) to anon, authenticated;
grant execute on function public.admin_set_plan(text, text)  to authenticated;

-- ============================================================================
-- Done. Server env (Vercel): FREE_BRIEFS_PER_MONTH=3 (default). AI_MONTHLY_LIMIT
-- is retired — the per-plan limit replaces it (free = FREE_BRIEFS_PER_MONTH,
-- pro = unlimited, still IP-hourly-capped by check_ip_rate).
-- ============================================================================
