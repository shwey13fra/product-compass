-- Product Compass — Stage 7: login, admin, and private referral collaboration.
-- Run ONCE in the Supabase SQL editor (runs as service-role → bypasses RLS).
-- Idempotent: safe to re-run. Run AFTER seed.sql + roles-rls-policy.sql +
-- applications-table.sql.
--
-- SECURITY MODEL (read this):
--   * This is the first AUTH-based RLS in the app. The existing `applications`
--     table stays anonymous + permissive (personal tracking, no login) and is
--     NOT touched here. `roles` stays publicly readable; we only lock its WRITES
--     to admins.
--   * Admins are identified IN POSTGRES by public.is_admin() (email allow-list
--     below). This MUST be kept in sync with ADMIN_EMAILS in src/config.ts.
--   * `comments` policies intentionally DO NOT reference is_admin(): an admin's
--     own session structurally cannot read or write comment rows. Admins see only
--     that a thread exists (referral_applications.comment_count), never contents.

-- ============================================================================
-- 1) Admin identity — keep this list in sync with ADMIN_EMAILS in src/config.ts
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') = any (
    array[
      -- Keep in sync with ADMIN_EMAILS in src/config.ts. Lowercase.
      'sabbyicon@gmail.com',
      'shwetaswain13november@gmail.com'
    ]::text[]
  );
$$;

-- Convenience: the signed-in user's lowercased email (or '' when anonymous).
create or replace function public.current_email()
returns text
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '');
$$;

-- ============================================================================
-- 2) profiles — one row per signed-in user, auto-created on sign-up
-- ============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles select own or admin" on public.profiles;
create policy "profiles select own or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert with check (id = auth.uid());

-- Auto-insert a profile when a new auth user is created (SECURITY DEFINER →
-- bypasses RLS). Idempotent on conflict.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, lower(new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 3) roles — add referral columns; keep public READ, lock WRITES to admins
-- ============================================================================
alter table public.roles
  add column if not exists is_referral    boolean not null default false,
  add column if not exists referrer_email text;

-- Public SELECT already granted by roles-rls-policy.sql. Add admin-only writes.
drop policy if exists "roles admin insert" on public.roles;
create policy "roles admin insert" on public.roles
  for insert to authenticated with check (public.is_admin());

drop policy if exists "roles admin update" on public.roles;
create policy "roles admin update" on public.roles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "roles admin delete" on public.roles;
create policy "roles admin delete" on public.roles
  for delete to authenticated using (public.is_admin());

-- ============================================================================
-- 4) referral_applications — shared between referee, referrer (by email), admin
-- ============================================================================
create table if not exists public.referral_applications (
  id                 uuid primary key default gen_random_uuid(),
  role_id            text not null,                  -- = roles.id (no FK: roles.id
                                                     --   type is managed in Supabase;
                                                     --   mirrors applications.role_id)
  referee_id         uuid not null references auth.users (id) on delete cascade,
  referrer_email     text not null,                  -- tagged on the role by admin
  status             text not null default 'applied'
                       check (status in ('applied','seen','shared_with_hm','shortlisted','closed')),
  status_changed_at  timestamptz not null default now(),
  comment_count      int not null default 0,         -- maintained by trigger (§6)
  last_comment_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (role_id, referee_id)                       -- one application per referee per role
);

create index if not exists referral_applications_referee_idx
  on public.referral_applications (referee_id);
create index if not exists referral_applications_referrer_email_idx
  on public.referral_applications (lower(referrer_email));

alter table public.referral_applications enable row level security;

-- Visible to the referee, the tagged referrer (matched by email), and admins.
drop policy if exists "ref_apps select" on public.referral_applications;
create policy "ref_apps select" on public.referral_applications
  for select to authenticated using (
    referee_id = auth.uid()
    or lower(referrer_email) = public.current_email()
    or public.is_admin()
  );

-- Only the referee creates the application (referee_id must be themselves).
drop policy if exists "ref_apps insert" on public.referral_applications;
create policy "ref_apps insert" on public.referral_applications
  for insert to authenticated with check (referee_id = auth.uid());

-- Status updatable by referee, referrer, or admin (override).
drop policy if exists "ref_apps update" on public.referral_applications;
create policy "ref_apps update" on public.referral_applications
  for update to authenticated using (
    referee_id = auth.uid()
    or lower(referrer_email) = public.current_email()
    or public.is_admin()
  ) with check (
    referee_id = auth.uid()
    or lower(referrer_email) = public.current_email()
    or public.is_admin()
  );

-- ============================================================================
-- 5) comments — referee + referrer ONLY. Admins are structurally excluded.
-- ============================================================================
create table if not exists public.comments (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.referral_applications (id) on delete cascade,
  author_id       uuid not null references auth.users (id) on delete cascade,
  author_email    text,
  body            text not null check (length(trim(body)) > 0),
  created_at      timestamptz not null default now()
);

create index if not exists comments_application_idx
  on public.comments (application_id, created_at);

alter table public.comments enable row level security;

-- A participant = the application's referee OR the tagged referrer. NO is_admin().
-- (Defined as a helper so SELECT and INSERT stay identical and auditable.)
create or replace function public.is_thread_participant(app_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.referral_applications ra
    where ra.id = app_id
      and (
        ra.referee_id = auth.uid()
        or lower(ra.referrer_email) = public.current_email()
      )
  );
$$;

drop policy if exists "comments participant select" on public.comments;
create policy "comments participant select" on public.comments
  for select to authenticated using (public.is_thread_participant(application_id));

drop policy if exists "comments participant insert" on public.comments;
create policy "comments participant insert" on public.comments
  for insert to authenticated with check (
    author_id = auth.uid()
    and public.is_thread_participant(application_id)
  );

-- ============================================================================
-- 6) comment_count / last_comment_at trigger — lets admins see "a thread exists"
--    without being able to read any comment row (SECURITY DEFINER).
-- ============================================================================
create or replace function public.bump_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.referral_applications
    set comment_count = comment_count + 1,
        last_comment_at = new.created_at
    where id = new.application_id;
  return new;
end;
$$;

drop trigger if exists comments_after_insert on public.comments;
create trigger comments_after_insert
  after insert on public.comments
  for each row execute function public.bump_comment_count();

-- ============================================================================
-- 7) application_reads — per-user last-seen, drives the in-app unread indicator
-- ============================================================================
create table if not exists public.application_reads (
  application_id  uuid not null references public.referral_applications (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  last_seen_at    timestamptz not null default now(),
  primary key (application_id, user_id)
);

alter table public.application_reads enable row level security;

drop policy if exists "reads own select" on public.application_reads;
create policy "reads own select" on public.application_reads
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "reads own insert" on public.application_reads;
create policy "reads own insert" on public.application_reads
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "reads own update" on public.application_reads;
create policy "reads own update" on public.application_reads
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- Done. Reminder: add your admin email to BOTH is_admin() (above) and
-- ADMIN_EMAILS in src/config.ts. // TODO(v2): email notifications on new
-- comment / status change.
-- ============================================================================
