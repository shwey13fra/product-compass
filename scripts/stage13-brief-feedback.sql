-- Product Compass — Stage 13: brief feedback.
-- Run ONCE in the Supabase SQL editor (service role → bypasses RLS). Idempotent.
--
-- SECURITY: anon key only, NEVER service-role. `brief_feedback` is keyed by the
-- anonymous compass_uid, which is a SECRET the client holds — not a verified
-- claim. So RLS is DENY-ALL for anon (no policies) and every uid-scoped read or
-- write goes through a SECURITY DEFINER function that REQUIRES the caller to
-- present the exact uid. No function lists uids, so enumeration is impossible.
-- This mirrors `applications` (scripts/stage11-ai-quota-and-rls.sql:125-135).
--
--   WHY NOT A uid POLICY: the anon key is PUBLIC (it ships in the browser
--   bundle), so a policy like `using (uid = <uid the client sent>)` is satisfied
--   by simply claiming someone else's uid. A policy can only enforce what the
--   database can verify, and the database cannot verify a localStorage value.
--   Proven in session 12: a terminal curl with only the anon key successfully
--   called rpc/get_applications.
--
-- ⚠️ Additive: only creates a new table + functions. Safe to run before the
-- deploy. Stage 11 lesson still applies — the stage is not done until migration
-- AND deploy are both live and verified against the PRODUCTION url.

create table if not exists public.brief_feedback (
  id                  uuid primary key default gen_random_uuid(),
  uid                 text not null,                  -- compass_uid (secret)
  role_id             text not null,                  -- = roles.id (no FK; mirrors applications.role_id)
  brief_mode          text not null check (brief_mode in ('live','manual','unknown')),
  -- NULLABLE on purpose: the apply prompt ("did you use it?") can fire for a
  -- user who never rated, so a row may carry only used_in_application.
  rating              text check (rating in ('thumbs_up','thumbs_down')),
  used_in_application boolean,                        -- null = never asked / dismissed
  note                text check (note is null or length(note) <= 280),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (uid, role_id)                               -- one feedback per brief; upsert target
);

create index if not exists brief_feedback_created_idx on public.brief_feedback (created_at desc);

alter table public.brief_feedback enable row level security;

-- Deny-all for anon: NO policy is created for it. Admins may read (the
-- /admin/quality view) — same shape as sync_runs in stage 12.
drop policy if exists "brief_feedback read admin" on public.brief_feedback;
create policy "brief_feedback read admin" on public.brief_feedback
  for select to authenticated using (public.is_admin());

-- ============================================================================
-- RPCs. Each REQUIRES p_uid and filters by it. None returns a list of uids.
-- ============================================================================

create or replace function public.rate_brief(
  p_uid text, p_role text, p_mode text, p_rating text, p_note text
)
returns public.brief_feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.brief_feedback;
  v_note text;
begin
  if p_uid is null or length(trim(p_uid)) = 0 then raise exception 'uid required'; end if;
  if p_role is null or length(trim(p_role)) = 0 then raise exception 'role required'; end if;
  if p_mode is null or p_mode not in ('live','manual','unknown') then raise exception 'invalid mode'; end if;
  if p_rating is null or p_rating not in ('thumbs_up','thumbs_down') then raise exception 'invalid rating'; end if;

  -- A note only means anything on a thumbs-down; drop it otherwise so a stale
  -- complaint can't survive the user changing their mind to thumbs-up.
  v_note := case when p_rating = 'thumbs_down'
                 then nullif(trim(coalesce(p_note, '')), '')
                 else null end;
  if v_note is not null and length(v_note) > 280 then
    v_note := left(v_note, 280);
  end if;

  insert into public.brief_feedback (uid, role_id, brief_mode, rating, note)
       values (p_uid, p_role, p_mode, p_rating, v_note)
  on conflict (uid, role_id) do update
     set brief_mode = excluded.brief_mode,
         rating     = excluded.rating,
         note       = excluded.note,
         updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.report_brief_used(
  p_uid text, p_role text, p_mode text, p_used boolean
)
returns public.brief_feedback
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.brief_feedback;
begin
  if p_uid is null or length(trim(p_uid)) = 0 then raise exception 'uid required'; end if;
  if p_role is null or length(trim(p_role)) = 0 then raise exception 'role required'; end if;
  if p_mode is null or p_mode not in ('live','manual','unknown') then raise exception 'invalid mode'; end if;
  if p_used is null then raise exception 'used required'; end if;

  -- p_mode is only used on INSERT (this fires for users who never rated, and
  -- brief_mode is NOT NULL). On conflict we must NOT clobber a known mode with
  -- 'unknown', nor touch the rating.
  insert into public.brief_feedback (uid, role_id, brief_mode, used_in_application)
       values (p_uid, p_role, p_mode, p_used)
  on conflict (uid, role_id) do update
     set used_in_application = excluded.used_in_application,
         updated_at          = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.get_brief_feedback(p_uid text, p_role text)
returns setof public.brief_feedback
language sql
stable
security definer
set search_path = public
as $$
  select * from public.brief_feedback
   where uid = p_uid and role_id = p_role;
$$;

grant execute on function public.rate_brief(text, text, text, text, text)     to anon, authenticated;
grant execute on function public.report_brief_used(text, text, text, boolean) to anon, authenticated;
grant execute on function public.get_brief_feedback(text, text)               to anon, authenticated;

-- Done. // TODO(v2): retention/aggregation for old brief_feedback rows.
