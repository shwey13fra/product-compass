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

-- Tag the 50 illustrative sample rows so they are badged "Sample" now.
--
-- ⚠️ RETIRING THEM LATER: do NOT run `delete from public.roles where source='seed'`.
-- That predicate ALSO matches the Stage 7 REFERRAL role — it was created before
-- this backfill, so the line below swept it into 'seed' — and the delete would
-- silently take the warm path with it. Nothing would error.
-- Prefer a soft retire, the pattern the ingest pipeline already uses ("the bot
-- never deletes: expiry flips is_live=false and keeps history" —
-- scripts/stage12-cron-ingestion.sql):
--   update public.roles set is_live = false
--    where source = 'seed' and is_live = true and is_referral is not true;
-- See docs/superpowers/specs/2026-07-17-retire-seed-roles-design.md.
--
-- (Stage 13 fixed the generator: adminCreateReferralRole now sets
--  source='referral' explicitly, so new referral roles never land here.)
update public.roles set source = 'seed' where source is null;

-- Dedupe/upsert key for ingested rows (seed rows have null external_id).
create unique index if not exists roles_source_external_id_uidx
  on public.roles (source, external_id)
  where external_id is not null;
