-- ============================================================================
-- Stage 19 — referral status: server-enforced role rules
-- ============================================================================
-- Idempotent. Paste into the Supabase SQL editor and Run.
--
-- WHY: until now the per-role rules ("referrer drives the pipeline, referee can
-- only withdraw, admin can only close") lived ONLY in the UI (allowedStatusesFor).
-- The write path was a direct table UPDATE gated by an RLS policy that checked
-- *who* owns the row but NOT *what* status they set — so a referee could bypass
-- the hidden buttons and POST `status: shortlisted` straight to PostgREST and
-- Postgres would accept it. The rules were cosmetic, not enforced.
--
-- FIX: move the state machine into a SECURITY DEFINER RPC (the same pattern the
-- app already uses for `applications`), and DROP the permissive update policy so
-- direct status writes are denied. The RPC becomes the only way status changes.
--
-- The state machine:
--   referrer  → seen | shared_with_hm | shortlisted | closed   (drives the pipeline)
--   referee   → closed only                                    (Withdraw / self-exit)
--   admin     → closed only, AND only when the thread has been dormant 90+ days
--               (no status change AND no message) — cleanup, never surveillance.
--               "Position filled" isn't tracked in data, so 90-day dormancy is the
--               enforceable proxy for "it's been >3 months, close it".
--   anyone else → rejected.
-- Participant role beats admin (a referrer who is also an admin acts as referrer),
-- matching viewerRole() in src/lib/referrals.ts.
-- ============================================================================

create or replace function public.set_referral_status(
  p_app_id uuid,
  p_status text
)
returns public.referral_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app            public.referral_applications;
  v_email          text := public.current_email();
  v_uid            uuid := auth.uid();
  v_role           text;
  v_last_activity  timestamptz;
  v_dormant_cutoff timestamptz := now() - interval '90 days';
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  if p_status not in ('applied','seen','shared_with_hm','shortlisted','closed') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;

  select * into v_app
    from public.referral_applications
    where id = p_app_id;
  if not found then
    raise exception 'Referral not found.' using errcode = 'P0002';
  end if;

  -- Resolve caller role. Participant beats admin (mirrors viewerRole()).
  if v_app.referee_id = v_uid then
    v_role := 'referee';
  elsif v_email <> '' and lower(v_app.referrer_email) = v_email then
    v_role := 'referrer';
  elsif public.is_admin() then
    v_role := 'admin';
  else
    raise exception 'You do not have access to this referral.' using errcode = '42501';
  end if;

  -- Per-role transition rules.
  if v_role = 'referrer' then
    if p_status not in ('seen','shared_with_hm','shortlisted','closed') then
      raise exception 'Referrers cannot set that status.' using errcode = '42501';
    end if;

  elsif v_role = 'referee' then
    if p_status <> 'closed' then
      raise exception 'You can only withdraw (Close) your own application.'
        using errcode = '42501';
    end if;

  elsif v_role = 'admin' then
    if p_status <> 'closed' then
      raise exception 'Admins can only close a referral.' using errcode = '42501';
    end if;
    if v_app.status = 'closed' then
      raise exception 'This referral is already closed.' using errcode = '42501';
    end if;
    v_last_activity := greatest(
      v_app.status_changed_at,
      coalesce(v_app.last_comment_at, v_app.status_changed_at)
    );
    if v_last_activity >= v_dormant_cutoff then
      raise exception 'Admins can only close a referral after 90 days of inactivity.'
        using errcode = '42501';
    end if;
  end if;

  update public.referral_applications
     set status = p_status,
         status_changed_at = now(),
         updated_at = now()
   where id = p_app_id
   returning * into v_app;

  return v_app;
end;
$$;

grant execute on function public.set_referral_status(uuid, text) to authenticated;

-- Lock the direct write path: status now flows ONLY through the RPC above.
-- (INSERT stays open per its own policy; markRead writes application_reads; the
-- comment_count trigger is SECURITY DEFINER — none of them need UPDATE here.)
drop policy if exists "ref_apps update" on public.referral_applications;
