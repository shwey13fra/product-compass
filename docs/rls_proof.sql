-- ============================================================================
-- Product Compass — RLS proof: admins are STRUCTURALLY unable to read comments.
-- ============================================================================
--
-- WHAT THIS PROVES (the Stage 7 privacy guarantee, at the database layer):
--   * The tagged REFEREE   can SELECT the thread's comments  → all N rows.
--   * The tagged REFERRER   can SELECT the thread's comments  → all N rows.
--   * An ADMIN              CANNOT SELECT any of them          → 0 rows,
--     even though the admin CAN see that the thread exists (comment_count on
--     referral_applications). This is enforced by RLS — the `comments` policies
--     reference ONLY referee/referrer via is_thread_participant(), never
--     is_admin() — so it cannot be bypassed by application code.
--
-- HOW IT WORKS:
--   Supabase RLS decides access from (1) the active Postgres ROLE and (2) the
--   JWT claims in `request.jwt.claims` (auth.uid() reads ->>'sub';
--   auth.jwt()->>'email' / current_email() read ->>'email'). We reproduce a real
--   signed-in request by SET ROLE authenticated + set_config('request.jwt.claims').
--   Everything runs inside a single DO block; the settings are transaction-local
--   (is_local = true) and reset automatically when the block's implicit
--   transaction ends. Nothing is mutated.
--
-- PRE-REQ: run the three-persona click-through in VERIFICATION_STAGE9.md FIRST so
--   at least one referral_applications row has comment_count > 0. This script
--   picks the thread with the most messages. If none exists it raises a clear
--   error telling you to seed one.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and Run. Read the
--   NOTICE output. A failed assertion RAISEs an EXCEPTION and aborts (proof failed).
--   The final "ALL RLS ASSERTIONS PASSED" notice means the guarantee holds.
--
-- SAFE TO RE-RUN: read-only; no INSERT/UPDATE/DELETE.
-- ============================================================================

do $proof$
declare
  -- The admin email MUST match one in is_admin() / ADMIN_EMAILS. If you used a
  -- different admin in the click-through, change it here.
  v_admin_email   text := 'shwetaswain13november@gmail.com';

  v_app_id        uuid;
  v_referee_id    uuid;
  v_referrer_mail text;
  v_referee_mail  text;
  v_total         int;      -- ground-truth comment count (as table owner, no RLS)
  v_admin_appcnt  int;      -- how many referral_applications the admin can see
  v_admin_shows   int;      -- comment_count the admin sees on that row (leak = OK)

  n_referee       int;
  n_referrer      int;
  n_admin         int;
begin
  -- --------------------------------------------------------------------------
  -- 0) Ground truth — gathered as the invoking (owner) role, BEFORE dropping to
  --    `authenticated`. Pick the thread with the most comments.
  -- --------------------------------------------------------------------------
  select ra.id, ra.referee_id, lower(ra.referrer_email), ra.comment_count
    into v_app_id, v_referee_id, v_referrer_mail, v_total
    from public.referral_applications ra
   where ra.comment_count > 0
   order by ra.comment_count desc, ra.created_at desc
   limit 1;

  if v_app_id is null then
    raise exception
      'No referral thread with comments found. Run the three-persona click-through in VERIFICATION_STAGE9.md first (steps b–c) so a thread has >= 1 message.';
  end if;

  -- Cross-check the trigger-maintained count against the real row count.
  if v_total is distinct from (select count(*) from public.comments where application_id = v_app_id) then
    raise exception 'comment_count (%) disagrees with actual comment rows — investigate bump_comment_count trigger.',
      v_total;
  end if;

  select lower(u.email) into v_referee_mail from auth.users u where u.id = v_referee_id;

  raise notice '--- Ground truth ---------------------------------------------';
  raise notice 'thread (application) id : %', v_app_id;
  raise notice 'referee  : %  (id %)', v_referee_mail, v_referee_id;
  raise notice 'referrer : %', v_referrer_mail;
  raise notice 'admin    : %', v_admin_email;
  raise notice 'comments in thread (ground truth) : %', v_total;
  raise notice '--------------------------------------------------------------';

  -- --------------------------------------------------------------------------
  -- 1) Impersonate the REFEREE — expect to see ALL comments.
  --    SET ROLE authenticated so the `to authenticated` policies apply; set the
  --    JWT claims so auth.uid()/current_email() resolve to the referee.
  -- --------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_referee_id, 'email', v_referee_mail, 'role', 'authenticated')::text,
    true
  );
  select count(*) into n_referee from public.comments where application_id = v_app_id;
  raise notice 'REFEREE  sees % comment row(s)  (expected %)', n_referee, v_total;
  if n_referee <> v_total then
    raise exception 'FAIL: referee should see all % comments but saw %.', v_total, n_referee;
  end if;

  -- --------------------------------------------------------------------------
  -- 2) Impersonate the REFERRER (matched by email) — expect to see ALL comments.
  --    'sub' is a throwaway uuid: the referrer is authorised by EMAIL, not id.
  -- --------------------------------------------------------------------------
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'email', v_referrer_mail, 'role', 'authenticated')::text,
    true
  );
  select count(*) into n_referrer from public.comments where application_id = v_app_id;
  raise notice 'REFERRER sees % comment row(s)  (expected %)', n_referrer, v_total;
  if n_referrer <> v_total then
    raise exception 'FAIL: referrer should see all % comments but saw %.', v_total, n_referrer;
  end if;

  -- --------------------------------------------------------------------------
  -- 3) Impersonate the ADMIN — expect ZERO comments (the whole point).
  --    is_admin() is TRUE for this email, but the comments policies never call
  --    is_admin(), so the admin is structurally excluded from the rows.
  -- --------------------------------------------------------------------------
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'email', v_admin_email, 'role', 'authenticated')::text,
    true
  );
  select count(*) into n_admin from public.comments where application_id = v_app_id;
  raise notice 'ADMIN    sees % comment row(s)  (expected 0)', n_admin;
  if n_admin <> 0 then
    raise exception 'FAIL: admin read % comment row(s) — the privacy guarantee is BROKEN.', n_admin;
  end if;

  -- --------------------------------------------------------------------------
  -- 4) Positive control: the admin CAN see that the thread EXISTS and its COUNT
  --    (via referral_applications), just not the contents. Proves the admin is
  --    a legitimately-authorised viewer of the application — the 0 rows above is
  --    RLS on `comments`, not a lack of any access at all.
  -- --------------------------------------------------------------------------
  select count(*), coalesce(max(comment_count), -1)
    into v_admin_appcnt, v_admin_shows
    from public.referral_applications
   where id = v_app_id;
  raise notice 'ADMIN    sees the application row: % (expected 1), with comment_count % (expected %)',
    v_admin_appcnt, v_admin_shows, v_total;
  if v_admin_appcnt <> 1 then
    raise exception 'FAIL: admin should see the referral_application row (thread-exists signal) but saw %.', v_admin_appcnt;
  end if;
  if v_admin_shows <> v_total then
    raise exception 'FAIL: admin comment_count (%) should equal the real count (%).', v_admin_shows, v_total;
  end if;

  raise notice '==============================================================';
  raise notice '✅ ALL RLS ASSERTIONS PASSED';
  raise notice '   referee=% referrer=% admin=%(rows)  admin sees thread-exists=yes, contents=no',
    n_referee, n_referrer, n_admin;
  raise notice '==============================================================';
end
$proof$;
