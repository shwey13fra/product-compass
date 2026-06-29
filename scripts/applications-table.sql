-- Stage 5 — applications table (status tracking, keyed by compass_uid).
-- Run this in the Supabase SQL editor (service-role), same flow as seed.sql.
--
-- HONEST SECURITY NOTE (v1 has no auth):
-- RLS is enabled but the policies below are PERMISSIVE — anon can read/write any
-- row. Rows are filtered by owner_key (= compass_uid) on the CLIENT, which is
-- *filtering, not isolation*: anyone with the public anon key could read all
-- rows. This is acceptable ONLY because we store role-status, nothing sensitive.
-- Add Supabase Auth + owner-scoped RLS in v2 before storing anything private.

create table if not exists public.applications (
  id                 uuid primary key default gen_random_uuid(),
  owner_key          text not null,                 -- = compass_uid (localStorage)
  role_id            text not null,                 -- references roles.id
  status             text not null default 'applied'
                       check (status in ('applied','seen','shared_with_hm','shortlisted','closed')),
  status_changed_at  timestamptz not null default now(),  -- drives the "Seen" nudge
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (owner_key, role_id)                       -- one application per role per browser
);

create index if not exists applications_owner_key_idx on public.applications (owner_key);

alter table public.applications enable row level security;

-- Permissive anon policies (see honest note above). Split per command so the
-- intent is explicit and easy to tighten in v2.
drop policy if exists "applications anon select" on public.applications;
create policy "applications anon select" on public.applications
  for select using (true);

drop policy if exists "applications anon insert" on public.applications;
create policy "applications anon insert" on public.applications
  for insert with check (true);

drop policy if exists "applications anon update" on public.applications;
create policy "applications anon update" on public.applications
  for update using (true) with check (true);

drop policy if exists "applications anon delete" on public.applications;
create policy "applications anon delete" on public.applications
  for delete using (true);

-- --- Demo helper -------------------------------------------------------------
-- To see the time-based "Good time for a light follow-up" nudge without waiting,
-- backdate a Seen application (replace the ids):
--   update public.applications
--     set status = 'seen', status_changed_at = now() - interval '14 days'
--     where owner_key = '<your compass_uid>' and role_id = '<role id>';
