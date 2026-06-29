-- Product Compass — RLS policy for the shared `roles` table.
-- Run once in the Supabase SQL editor.
--
-- Why: RLS is enabled on `roles` with no policies, so the app's ANON key
-- can't read the rows (it gets an empty result, no error → "No roles yet").
-- `roles` is shared, non-sensitive seed data, so we grant PUBLIC READ only.
-- We intentionally grant NO insert/update/delete to anon — seeding stays a
-- service-role / SQL-editor operation.

alter table public.roles enable row level security;

drop policy if exists "Public read access to roles" on public.roles;

create policy "Public read access to roles"
  on public.roles
  for select
  to anon, authenticated
  using (true);
