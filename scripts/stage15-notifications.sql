-- Product Compass — Stage 15: email notifications for referral collaboration.
-- Run ONCE in the Supabase SQL editor (service role → bypasses RLS). Idempotent.
--
-- SECURITY: anon key only, NEVER service-role. The two facts that shape this:
--   * The RECIPIENT of a notification is the OTHER party. When the referrer acts,
--     the recipient is the referee, whose email lives in `profiles` and is NOT
--     readable by the referrer under RLS. So recipient resolution runs in a
--     SECURITY DEFINER function that first proves the caller is a participant —
--     a non-party can never use it to harvest an email.
--   * Prefs + unsubscribe are keyed by EMAIL (not user_id) because the referrer
--     may be tagged by email without ever registering.
--
-- ⚠️ ADDITIVE + idempotent. Depends on Stage 7 (referral_applications, comments,
-- profiles, current_email(), is_admin()). Stage 11 lesson still applies: not done
-- until migration AND deploy are live and verified against the PRODUCTION url.

-- ============================================================================
-- 1) notification_prefs — per-EMAIL email toggle + unsubscribe capability token.
--    Absence of a row = enabled (default-on). The account-menu toggle writes the
--    signed-in user's own row; the send path lazily creates a row so a stable
--    unsubscribe token always exists.
-- ============================================================================
create table if not exists public.notification_prefs (
  email             text primary key,
  emails_enabled    boolean not null default true,
  unsubscribe_token uuid not null default gen_random_uuid(),
  user_id           uuid,
  updated_at        timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

-- A signed-in user may read/write ONLY their own row (matched by verified email).
drop policy if exists "notif_prefs select own" on public.notification_prefs;
create policy "notif_prefs select own" on public.notification_prefs
  for select to authenticated using (lower(email) = public.current_email());

drop policy if exists "notif_prefs insert own" on public.notification_prefs;
create policy "notif_prefs insert own" on public.notification_prefs
  for insert to authenticated with check (lower(email) = public.current_email());

drop policy if exists "notif_prefs update own" on public.notification_prefs;
create policy "notif_prefs update own" on public.notification_prefs
  for update to authenticated
  using (lower(email) = public.current_email())
  with check (lower(email) = public.current_email());

-- ============================================================================
-- 2) notification_log — backs the comment throttle (max 1/thread/recipient/10min)
--    and is a lightweight send audit. RLS deny-all: only the definer touches it.
-- ============================================================================
create table if not exists public.notification_log (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null,
  kind            text not null check (kind in ('status','comment')),
  recipient_email text not null,
  sent_at         timestamptz not null default now()
);

create index if not exists notification_log_throttle_idx
  on public.notification_log (application_id, recipient_email, kind, sent_at desc);

alter table public.notification_log enable row level security;
-- No policies → deny-all for anon/authenticated; only resolve_notification writes.

-- ============================================================================
-- 3) resolve_notification — the core resolver, run as the ACTING user
--    (auth.uid() = caller of the forwarded-token route). Proves participation,
--    picks the other party, checks prefs, and (comments only) enforces + records
--    the 10-min throttle. Returns everything the route needs to send one email.
--
--    Throttle note: the log row is recorded OPTIMISTICALLY when allowed=true
--    (before Resend confirms). Fire-and-forget never retries, so we prefer
--    under-emailing to a spam loop — acceptable for v1.
-- ============================================================================
create or replace function public.resolve_notification(p_app_id uuid, p_kind text)
returns table(
  allowed           boolean,
  reason            text,
  recipient_email   text,
  recipient_role    text,       -- 'referee' | 'referrer' — lets the route label the author
  role_title        text,
  company           text,
  unsubscribe_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_email     text := public.current_email();   -- lowercased caller email, or ''
  v_referee   uuid;
  v_ref_email text;                              -- referrer_email on the row (lowercased)
  v_role_id   text;
  v_recipient text;
  v_rcpt_role text;
  v_title     text;
  v_company   text;
  v_enabled   boolean;
  v_token     uuid;
  v_recent    int;
begin
  if p_kind not in ('status','comment') then raise exception 'invalid kind'; end if;
  if v_actor is null then raise exception 'must be signed in'; end if;

  select ra.referee_id, lower(ra.referrer_email), ra.role_id
    into v_referee, v_ref_email, v_role_id
    from public.referral_applications ra
   where ra.id = p_app_id;
  if not found then
    return query select false, 'no-app', null::text, null::text, null::text, null::text, null::uuid; return;
  end if;

  -- Participation gate: only a party (or an admin override) may trigger a notify.
  if not (v_actor = v_referee or v_email = v_ref_email or public.is_admin()) then
    return query select false, 'not-participant', null::text, null::text, null::text, null::text, null::uuid; return;
  end if;

  -- Recipient = the OTHER party. Referee acts → referrer (by email). Referrer or
  -- admin acts → referee (email from profiles; admin override routes to the applicant).
  if v_actor = v_referee then
    v_recipient := v_ref_email;
    v_rcpt_role := 'referrer';                    -- referee acted → other party is the referrer
  else
    select lower(p.email) into v_recipient from public.profiles p where p.id = v_referee;
    v_rcpt_role := 'referee';                     -- referrer/admin acted → other party is the referee
  end if;

  if coalesce(v_recipient, '') = '' then
    return query select false, 'no-recipient', null::text, null::text, null::text, null::text, null::uuid; return;
  end if;
  -- Never email the actor themselves (e.g. admin who is also the tagged referrer).
  if v_recipient = v_email then
    return query select false, 'self', null::text, null::text, null::text, null::text, null::uuid; return;
  end if;

  -- Role context for the template (roles.id may be uuid or text → cast to text).
  select r.title, r.company into v_title, v_company
    from public.roles r where r.id::text = v_role_id;

  -- Ensure a prefs row exists (stable unsubscribe token), then read the toggle.
  insert into public.notification_prefs (email) values (v_recipient)
    on conflict (email) do nothing;
  select emails_enabled, unsubscribe_token into v_enabled, v_token
    from public.notification_prefs where email = v_recipient;

  if v_enabled is false then
    return query select false, 'opted-out', v_recipient, v_rcpt_role, v_title, v_company, v_token; return;
  end if;

  -- Throttle: at most one COMMENT email per (thread, recipient) per 10 minutes.
  if p_kind = 'comment' then
    select count(*) into v_recent
      from public.notification_log
     where application_id = p_app_id
       and recipient_email = v_recipient
       and kind = 'comment'
       and sent_at > now() - interval '10 minutes';
    if v_recent > 0 then
      return query select false, 'throttled', v_recipient, v_rcpt_role, v_title, v_company, v_token; return;
    end if;
  end if;

  -- Record the send (optimistic) and allow it.
  insert into public.notification_log (application_id, kind, recipient_email)
       values (p_app_id, p_kind, v_recipient);

  return query select true, 'ok', v_recipient, v_rcpt_role, v_title, v_company, v_token;
end;
$$;

-- ============================================================================
-- 4) unsubscribe_by_token — flip emails off from a one-click link (NO login).
-- ============================================================================
create or replace function public.unsubscribe_by_token(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_found boolean;
begin
  update public.notification_prefs
     set emails_enabled = false, updated_at = now()
   where unsubscribe_token = p_token;
  get diagnostics v_found = row_count;
  return v_found;
end;
$$;

-- ============================================================================
-- 5) Grants — resolve_notification is called from the forwarded-token routes
--    (authenticated). Unsubscribe must work for a logged-out click (anon).
-- ============================================================================
grant execute on function public.resolve_notification(uuid, text) to authenticated;
grant execute on function public.unsubscribe_by_token(uuid)       to anon, authenticated;

-- Done. // TODO(v2): retention/compaction of notification_log; per-kind prefs;
-- digest batching instead of a hard 10-min comment throttle.
