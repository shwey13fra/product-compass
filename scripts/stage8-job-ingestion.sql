-- Stage 8 — job ingestion. Idempotent: safe to re-run.
-- Run in the Supabase SQL editor AFTER stage7-auth-referrals.sql.
-- Adds ingestion columns to roles; tags existing sample rows as source='seed'.
-- No new RLS: existing public-read + admin-write policies on roles cover
-- ingested rows (the ingest route writes with the admin's forwarded JWT).

alter table public.roles
  add column if not exists source       text,
  add column if not exists external_id  text,
  add column if not exists apply_url    text,
  add column if not exists ingested_at  timestamptz;

-- Tag the 50 illustrative sample rows so they are badged "Sample" now and
-- deletable later with:  delete from public.roles where source = 'seed';
update public.roles set source = 'seed' where source is null;

-- Dedupe/upsert key for ingested rows (seed rows have null external_id).
create unique index if not exists roles_source_external_id_uidx
  on public.roles (source, external_id)
  where external_id is not null;
