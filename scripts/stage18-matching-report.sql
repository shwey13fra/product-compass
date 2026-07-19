-- Product Compass — Stage 18: matching-report aggregation. Run ONCE in the
-- Supabase SQL editor. Idempotent. Run AFTER stage7 (is_admin) + stage10 (events).
--
-- WHY AN RPC: `events` is INSERT-only RLS (stage10) — no SELECT policy, so neither
-- anon nor authenticated can read it directly, not even an admin. This SECURITY
-- DEFINER function is the ONLY read path, and it self-gates on is_admin().
--
-- It computes the three Stage 18 numbers from the `applied` / `role_viewed` /
-- `onboarding_completed` events (surface + rank + stated archetypes are captured
-- client-side; see Stage 18 instrumentation). Returns one JSON blob:
--   { total_applications, by_surface{}, avg_rank, archetype_match_rate, per_user[] }

create or replace function public.admin_matching_report()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  with applies as (
    select
      coalesce(e.user_id::text, e.uid) as identity,
      e.props->>'role_id'              as role_id,
      e.props->>'surface'              as surface,
      nullif(e.props->>'rank', '')::int as rank
    from public.events e
    where e.name = 'applied'
  ),
  -- Latest stated-preference archetypes per identity (most recent onboarding).
  prefs as (
    select distinct on (identity) identity, archetypes
    from (
      select coalesce(e.user_id::text, e.uid) as identity,
             e.created_at,
             e.props->'archetypes' as archetypes
      from public.events e
      where e.name = 'onboarding_completed'
    ) x
    order by identity, created_at desc
  ),
  joined as (
    select a.*, r.archetype as role_archetype, p.archetypes as pref_archetypes
    from applies a
    left join public.roles r on r.id::text = a.role_id
    left join prefs p on p.identity = a.identity
  )
  select jsonb_build_object(
    'total_applications', (select count(*) from applies),
    'by_surface', coalesce(
      (select jsonb_object_agg(coalesce(surface, 'unknown'), c)
         from (select surface, count(*) c from applies group by surface) s),
      '{}'::jsonb
    ),
    'avg_rank', (select round(avg(rank)::numeric, 2) from applies where rank is not null),
    'archetype_match_rate', (
      select round(
        100.0 * count(*) filter (where pref_archetypes ? role_archetype)
        / nullif(count(*) filter (where pref_archetypes is not null and role_archetype is not null), 0),
      1)
      from joined
    ),
    'per_user', coalesce((
      select jsonb_agg(row) from (
        select jsonb_build_object(
          'identity', identity,
          'applications', count(*),
          'top_pct', round(100.0 * count(*) filter (where surface = 'top') / nullif(count(*), 0), 0),
          'avg_rank', round(avg(rank)::numeric, 1),
          'archetype_match_pct', round(
            100.0 * count(*) filter (where pref_archetypes ? role_archetype)
            / nullif(count(*) filter (where pref_archetypes is not null and role_archetype is not null), 0),
          0)
        ) as row
        from joined
        group by identity
        order by count(*) desc
        limit 100
      ) u
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_matching_report() to authenticated;

-- Done. Read it via GET /api/admin/matching-report (passes the admin's JWT so
-- is_admin() resolves), or call select public.admin_matching_report() here.
