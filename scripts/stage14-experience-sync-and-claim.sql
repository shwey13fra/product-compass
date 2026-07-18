-- Product Compass — Stage 14: experience-profile sync + anonymous→auth claim.
-- Run ONCE in the Supabase SQL editor (service role → bypasses RLS). Idempotent.
--
-- SECURITY (unchanged model): anon key only, NEVER service-role. `experience_profiles`
-- is keyed by owner_key = the auth user id when signed in, else the anonymous
-- compass_uid (a SECRET the client holds — not a verified claim). So RLS is
-- DENY-ALL for anon (no policy) and every owner-scoped read/write goes through a
-- SECURITY DEFINER function that REQUIRES the caller to present the exact
-- owner_key. No function lists owner_keys → enumeration is impossible. This
-- mirrors `applications` (scripts/stage11-ai-quota-and-rls.sql:125-135) and
-- `brief_feedback` (scripts/stage13-brief-feedback.sql).
--
--   WHY NOT AN auth.uid() SELECT POLICY: for signed-in users owner_key *is*
--   auth.uid(), so a policy could verify it — but for anon users the anon key is
--   PUBLIC and a uid policy is satisfied by claiming someone else's uid. Keeping
--   ONE uniform door (deny-all + definer RPC that demands the key) is simpler and
--   equally safe for the signed-in case (the RPC still requires the exact key).
--
-- ⚠️ ADDITIVE + BACKWARD-COMPATIBLE: only creates a new table + functions; drops
-- NO existing policy and moves NO data until the new app code calls
-- claim_anonymous_data(). So there is no silent-empty window between migrate and
-- deploy (the Stage 11 lesson) — but the stage is still not done until migration
-- AND deploy are both live and verified against the PRODUCTION url.

-- ============================================================================
-- 1) experience_profiles — one row per owner_key (auth id or compass_uid).
--    payload = the whole ExperienceProfile object (src/lib/experience.ts).
--    updated_at = the payload's OWN ISO timestamp, so cross-device newest-wins
--    works (we compare the two updated_at values on load).
-- ============================================================================
create table if not exists public.experience_profiles (
  owner_key   text primary key,
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.experience_profiles enable row level security;

-- Deny-all for anon: NO policy is created for it. Admins may read (parity with
-- brief_feedback / sync_runs) — never needed by the app, only for inspection.
drop policy if exists "experience_profiles read admin" on public.experience_profiles;
create policy "experience_profiles read admin" on public.experience_profiles
  for select to authenticated using (public.is_admin());

-- ----------------------------------------------------------------------------
-- get_experience — the row for exactly this owner_key (or nothing).
-- ----------------------------------------------------------------------------
create or replace function public.get_experience(p_owner text)
returns setof public.experience_profiles
language sql
stable
security definer
set search_path = public
as $$
  select * from public.experience_profiles where owner_key = p_owner;
$$;

-- ----------------------------------------------------------------------------
-- upsert_experience — write, but NEVER let a stale push clobber a newer row.
-- Returns the EFFECTIVE row (whatever is current after the guarded write), so
-- the client can reconcile its local copy against the winner.
-- ----------------------------------------------------------------------------
create or replace function public.upsert_experience(
  p_owner text, p_payload jsonb, p_updated_at timestamptz
)
returns setof public.experience_profiles
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_owner is null or length(trim(p_owner)) = 0 then raise exception 'owner required'; end if;
  if p_payload is null then raise exception 'payload required'; end if;

  insert into public.experience_profiles (owner_key, payload, updated_at)
       values (p_owner, p_payload, coalesce(p_updated_at, now()))
  on conflict (owner_key) do update
     set payload    = excluded.payload,
         updated_at = excluded.updated_at
   -- newest-payload-wins: skip the update when the incoming copy is older.
   where excluded.updated_at >= public.experience_profiles.updated_at;

  return query select * from public.experience_profiles where owner_key = p_owner;
end;
$$;

-- ============================================================================
-- 2) claim_anonymous_data — on first sign-in, re-key this device's anonymous
--    data (compass_uid) onto the VERIFIED auth user id. Idempotent: after the
--    first run the anon rows are gone, so re-running finds nothing to move.
--    Conflict rule per table below; the counter is SUMMED (signing in must not
--    grant free quota). Returns a jsonb summary of how many rows moved.
-- ============================================================================
create or replace function public.claim_anonymous_data(p_uid text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth uuid := auth.uid();
  v_key  text;
  v_apps int := 0;
  v_bf   int := 0;
  v_ev   int := 0;
  v_ai   int := 0;
  v_exp  int := 0;
begin
  if v_auth is null then raise exception 'must be signed in to claim'; end if;
  v_key := v_auth::text;
  -- Nothing to do: no anon id supplied, or it already equals the auth id.
  if coalesce(p_uid, '') = '' or p_uid = v_key then
    return jsonb_build_object('applications', 0, 'brief_feedback', 0,
                              'events', 0, 'ai_usage', 0, 'experience', 0);
  end if;

  -- --- applications (unique owner_key, role_id): newest updated_at wins -------
  delete from public.applications a
   where a.owner_key = p_uid
     and exists (select 1 from public.applications b
                  where b.owner_key = v_key and b.role_id = a.role_id
                    and b.updated_at >= a.updated_at);           -- auth wins (incl. ties)
  delete from public.applications b
   where b.owner_key = v_key
     and exists (select 1 from public.applications a
                  where a.owner_key = p_uid and a.role_id = b.role_id
                    and a.updated_at > b.updated_at);            -- anon strictly newer
  update public.applications set owner_key = v_key where owner_key = p_uid;
  get diagnostics v_apps = row_count;

  -- --- brief_feedback (unique uid, role_id): same newest-wins merge -----------
  delete from public.brief_feedback a
   where a.uid = p_uid
     and exists (select 1 from public.brief_feedback b
                  where b.uid = v_key and b.role_id = a.role_id
                    and b.updated_at >= a.updated_at);
  delete from public.brief_feedback b
   where b.uid = v_key
     and exists (select 1 from public.brief_feedback a
                  where a.uid = p_uid and a.role_id = b.role_id
                    and a.updated_at > b.updated_at);
  update public.brief_feedback set uid = v_key where uid = p_uid;
  get diagnostics v_bf = row_count;

  -- --- events: stamp the auth user id on this device's analytics (keep uid) ---
  update public.events set user_id = v_auth
   where uid = p_uid and user_id is null;
  get diagnostics v_ev = row_count;

  -- --- ai_usage (pk identity, period): SUM into the auth bucket, no free quota
  select count(*) into v_ai from public.ai_usage where identity = p_uid;
  insert into public.ai_usage (identity, period, count, updated_at)
       select v_key, period, count, now()
         from public.ai_usage where identity = p_uid
  on conflict (identity, period) do update
     set count      = public.ai_usage.count + excluded.count,
         updated_at = now();
  delete from public.ai_usage where identity = p_uid;

  -- --- experience_profiles (pk owner_key): newest payload wins ----------------
  delete from public.experience_profiles a
   where a.owner_key = p_uid
     and exists (select 1 from public.experience_profiles b
                  where b.owner_key = v_key and b.updated_at >= a.updated_at);
  delete from public.experience_profiles b
   where b.owner_key = v_key
     and exists (select 1 from public.experience_profiles a
                  where a.owner_key = p_uid and a.updated_at > b.updated_at);
  update public.experience_profiles set owner_key = v_key where owner_key = p_uid;
  get diagnostics v_exp = row_count;

  return jsonb_build_object(
    'applications', v_apps, 'brief_feedback', v_bf,
    'events', v_ev, 'ai_usage', v_ai, 'experience', v_exp
  );
end;
$$;

-- ============================================================================
-- 3) Grants — the anon (and signed-in) client may EXECUTE these; it has no
--    direct table rights that RLS would honor. claim_anonymous_data requires a
--    verified auth.uid() internally, so anon calling it just raises.
-- ============================================================================
grant execute on function public.get_experience(text)                                 to anon, authenticated;
grant execute on function public.upsert_experience(text, jsonb, timestamptz)          to anon, authenticated;
grant execute on function public.claim_anonymous_data(text)                           to anon, authenticated;

-- Done. // TODO(v2): retention/compaction for experience_profiles history;
-- background reconcile job if we ever store more than the single profile row.
