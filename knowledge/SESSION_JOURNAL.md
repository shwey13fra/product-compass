# Session Journal — Product Compass

> **READ THIS FIRST every session.** Top section = where we left off. Append a new
> entry at the end of each session. Keep "Current State" and "Next Up" honest and current.

---

## ▶ CURRENT STATE (last updated: 2026-07-07, end of session 9)

**Phase:** STAGE 1–8 ✅ built · **STAGE 8 (job ingestion) BUILT + committed to `main` (local, NOT yet pushed → no prod deploy yet), tests green, tsc+build clean — NOT yet live-verified.**
**Stage 8 what shipped (commits after `d1d5bb2`):** brainstorm→spec (`docs/superpowers/specs/2026-07-07-stage8-job-ingestion-design.md`)→plan (`docs/superpowers/plans/2026-07-07-stage8-job-ingestion.md`)→10 TDD tasks. New: `scripts/stage8-job-ingestion.sql` (adds `source/external_id/apply_url/ingested_at` to `roles`; tags 50 seed rows `source='seed'`; unique idx on `(source,external_id)`); `src/lib/realPmScore.ts` (pure-JS scorer + `inferArchetype`, NO AI); `src/lib/ingest/{types,normalize,sources,pipeline}.ts`; `src/app/api/ingest/route.ts` (POST, admin-JWT-forwarded writes); `src/components/ApplyOutButton.tsx`; `SourceBadge`+`sourceLabel` in `role-badges.tsx`; admin **"Sync jobs now"** panel. Tests: `scripts/tests/*.test.ts` run via `npx tsx` (added `tsx` devDep).
**Verified so far:** all 4 tsx tests pass; `tsc --noEmit` + `next build` clean (`/api/ingest` registered as ƒ). **Live integration probe against real Stripe Greenhouse board: 495 jobs → 24 PM after filter, scores 32–92, archetypes assigned, no HTML leak.** Company chosen for smoke test: **`stripe`** (in `GREENHOUSE_BOARDS`).
**NEXT-UP for Stage 8 (user smoke test):** (1) run `scripts/stage8-job-ingestion.sql` in Supabase; (2) set `ADZUNA_APP_ID`+`ADZUNA_APP_KEY` in `.env.local` + Vercel; (3) sign in as admin → `/admin` → "Sync jobs now" → expect added>0, `/roles` shows badged rows, Apply links out. That live write also proves the JWT/RLS path (a non-admin session 403s).
**Still also pending (pre-Stage-8 debt):** the Stage 7 three-persona referral RLS proof + the Stage 5 live tracking click-through (unchanged — see below).

---

## ▶ PRIOR STATE (end of session 8)

**Phase:** STAGE 1–7 ✅ · **STAGE 7 (auth + admin + referral collaboration) BUILT + DEPLOYED + sign-in/admin flow user-verified live.** Migration run, Gmail SMTP live, auth working end-to-end. Everything committed + pushed to `main` (HEAD `065360f`) and auto-deployed to Vercel.
**Stage 7 what shipped:** Supabase passwordless sign-in — **now via 8-digit OTP code (typed), not the magic link** (see session-8 fixes for why); admins via `ADMIN_EMAILS` (`src/config.ts`) mirrored by `public.is_admin()` SQL fn for RLS; admin view (post referral role `is_referral=true` + tag `referrer_email`; overview showing status + *thread-exists count*, never contents); referral roles badged in the main list; applying (sign-in-gated) creates a shared `referral_application`; per-application shared **status strip with role-based permissions** + a private comment thread readable ONLY by referee+referrer (admins structurally blocked by RLS); in-app unread dot. **Anonymous side (browse/positioning/personal tracking via `compass_uid`) untouched.**
**Status permissions (session 8):** referrer drives the pipeline (Seen / Shared w/HM / Shortlisted / Closed); referee can only set **Closed** (withdraw); admin overrides any. UX guardrail via `allowedStatusesFor()` in `src/lib/referrals.ts` + `StatusStrip` `allowed`/`hint` props (RLS still the real gate; anonymous `/tracking` strip unchanged = all-settable).
**Migration (already run in prod):** `scripts/stage7-auth-referrals.sql`. Idempotent. Fixed a runtime gap: admin `adminCreateReferralRole` now supplies `real_pm_signals: []` + `crowd_response_days: 7` (both NOT NULL on `roles`).
**Sync rule:** admin emails identical in `ADMIN_EMAILS` + `is_admin()`: `sabbyicon@gmail.com` + `shwetaswain13november@gmail.com`.
**Supabase auth config (done, lives in Supabase not git):** Gmail **custom SMTP** (sender `shwetaswain13november@gmail.com` + App Password); **"Confirm email" turned OFF** (new users were getting the code-less "Confirm signup" template → broke every non-existing email); "Magic link or OTP" template edited to include `{{ .Token }}`; redirect URLs `…lilac.vercel.app/**` + `localhost:3000/**`; Site URL = the lilac URL.
**Key safety re-verified:** no `service_role` anywhere; client uses only `NEXT_PUBLIC_*` (anon key); `ANTHROPIC_API_KEY` only in the server route.

**Phase (prior):** STAGE 1–5 ✅ (full v1 feature set) · **STAGE 6 (deploy + README)** ✅ — **LIVE on Vercel**.
**🌐 Live URL:** https://product-compass-lilac.vercel.app · **GitHub (PUBLIC):** https://github.com/shwey13fra/product-compass (personal account `shwey13fra`, branch `main`, commits `ea5f8e4` → `3309b71`). *(Vercel project recreated on a fresh import after the old `…-tau` project's Git link broke; repo made public — no secrets tracked, `.env.local` gitignored. Vercel env vars re-added on the new project.)*
**Vercel env vars set:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY` (server-side, no `NEXT_PUBLIC_` prefix). Same Supabase project in prod as dev (seed + RLS + applications-table already run there).
**Live verification (session 6):** server-side flow ✅ — `/roles` SSRs all 50 roles w/ scores (proves Supabase+env+RLS work in prod), role detail renders, `/api/position` deployed (405 on GET = POST-only), `/tracking` 200. **Interactive client flow (Apply→strip→nudge→persist, brief generation) NOT yet user-verified in a real browser** — see NEXT UP.
**Stage 5 spec:** `docs/superpowers/specs/2026-06-29-stage5-tracking-design.md`. Stage 5 `applications` table confirmed created (user saw cards, no red error box).
**Env:** `.env.local` has real keys. Supabase project = `https://mfqsledvtemerllqawgt.supabase.co` (bare URL, no `/rest/v1/`). **`ANTHROPIC_API_KEY` is set** (108 chars) — server-only, no `NEXT_PUBLIC_` prefix.
**Data:** `roles` table = **50 India-market roles** (illustrative postings on real company names, NOT live listings). Source of truth: `scripts/roles-data.mjs` → `node scripts/gen-seed-sql.mjs` regenerates `seed.sql` → run in Supabase SQL editor.
**RLS:** `roles` has RLS **on** + a public **SELECT** policy (`scripts/roles-rls-policy.sql`). Without it the app silently shows "No roles yet".
**To resume:** run `npm run dev` → http://localhost:3000/roles → open any role → "Position me for this role" panel at the bottom. (Server NOT running between sessions — start fresh. Stale Turbopack `0xc0000142` HMR 500s → `taskkill //PID <pid> //F`, `rm -rf .next/dev`, restart.)
**Repo:** git-initialized + pushed to private GitHub (see live/GitHub links above). `.gitignore` correctly excludes `.env.local` (verified before first commit — only `.env.example` placeholders are tracked).
**Stack live:** Next.js 16.2.9 (App Router, `src/`, Turbopack) · React 19 · TS · **Tailwind v4** (`@theme` tokens, no config file) · lucide-react · @supabase/supabase-js v2.
**Build status:** `npx tsc --noEmit` clean · `npx next build` clean · `/api/position` registered as dynamic server route · live call verified returning a real brief.
**Budget:** live "Position me" uses `claude-haiku-4-5`, `max_tokens 1024` ≈ **€0.003/run**. Per-process counter hard-stops at **15 calls** (override `POSITION_CALL_CAP`). Manual paste-in = **zero credits**. (User asked re: €5 credit — confirmed it draws that account's credit but cost is negligible; setting a Console spend cap deferred to "later".)

**Stage 2 files:** `src/lib/types.ts` (`getBand` sage/honey/brick, `getFreshness`) · `src/lib/roles.ts` · `src/app/roles/page.tsx` (+ `loading.tsx`, `[id]/page.tsx`, `[id]/not-found.tsx`) · `src/components/RoleCard.tsx`, `role-badges.tsx`.
**Stage 2.5 files:** `src/lib/preferences.ts` (pure-JS `scoreRole`) · `src/components/OnboardingModal.tsx` · `RolesBrowser.tsx`. localStorage: `compass_preferences`, `compass_onboarding_dismissed`.
**Stage 3 files (manual positioning, NO AI):** `src/lib/experience.ts` (`ExperienceProfile` + localStorage `compass_experience`) · `src/lib/positioning.ts` (`buildPositioningPrompt`, `parseBrief` [handles ```json fences + chatter], `computeFitRead` [theme-bucket % match + framable 30%], brief persistence `compass_brief:<roleId>`) · `src/components/ExperienceForm.tsx` · `src/components/PositioningPanel.tsx` (wired into `roles/[id]/page.tsx`).
**Stage 4 files (live AI on top):** `src/app/api/position/route.ts` (server route: reads `ANTHROPIC_API_KEY`, raw `fetch` to `api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`, reuses `buildPositioningPrompt`+`parseBrief`, 15-call counter, validation 400s don't spend a call). `PositioningPanel.tsx` extended: **"Position me" = live call (default)**, **"Paste it in manually" = Stage-3 fallback** with a "Back to live positioning" link; loading/error/low-calls states.

## ▶ BLOCKED ON USER — none

## ▶ NEXT UP — START HERE NEXT SESSION

**Roadmap:** Step 7 built + deployed + auth/admin verified live ✅ → **finish the Stage 7 three-persona verification** → the deferred Stage 5 live-flow confirm → then the **revision pass**.

1. **Finish the STAGE 7 three-persona test (in progress — sign-in + admin post + status permissions already work live).** Use `+alias` emails so every code lands in the one working inbox: **admin** `shwetaswain13november@gmail.com`, **referrer** `shwetaswain13november+referrer@gmail.com`, **referee** `shwetaswain13november+referee@gmail.com` (keep admin ≠ referee/referrer for a clean RLS proof). Run each in a separate browser/incognito. Steps: admin posts a referral role tagged with the +referrer alias → referee applies → sees warm thread prompt, can only set Closed → referrer signs in, sees unread dot, replies, drives Seen/Shared/Shortlisted → **RLS proof:** admin `/admin` sees status + "Thread · N messages" but the thread page shows the Lock card / 0 comment rows. **Sign in with the CODE, not the link** (link errors — Gmail scan + redirect fallback).
2. **Deferred: confirm the Stage 5 live interactive flow** on https://product-compass-lilac.vercel.app (signed out): role → "Mark as Applied" → /tracking → advance strip → **reload persists** → Seen → "Demo: simulate a week passing" → follow-up nudge → Closed → similar roles → generate a brief (manual free / one live ~€0.003).
3. **Then the revision pass** — polish: cap "Top matches" size, confirm-on-Reset, warm/cold duplication between role-detail static cards and Tracking cards, optional `NEXT_PUBLIC_DEMO_MODE` gate for the "simulate a week" button. **Optional auth hardening noted but not built:** handle a `?code=` that lands on `/` (Supabase Site-URL fallback) so a stray magic-link click still completes; set OTP length to 6 in Supabase if the 8-digit code feels long (app already accepts 6–10).

**PRD note (user wants everything tracked for the final PRD):** all features implemented/adapted are logged in the session log below + `DECISIONS.md`. Stage 5 adaptations vs the user's literal instructions are spelled out in the session-5 entry. Pull from there.

## ▶ OPEN QUESTIONS / BLOCKERS

- Budget backstop deferred: set a monthly spend cap in Anthropic Console → Billing (user said "later").
- Email delivery depends on the Gmail SMTP App Password staying valid; if codes stop arriving, check Supabase → Authentication → Logs + Rate Limits (built-in cap even with SMTP). Half-created unconfirmed users from earlier failed attempts may linger in Auth → Users (harmless; "Confirm email" is now OFF).
- Counter is per **server process** (resets on restart / new serverless instance) — a hard budget guard, not a per-user quota. Plumb `compass_uid` through if a true per-browser limit is wanted.
- Optional polish: "Top matches" can be large (~39/50 genuine) — could cap at 6–9; add a confirm on **Reset**.

---

## Session Log

### 2026-06-27 — Session 1 (setup)
- Created the `knowledge/` folder so future sessions can pick up where we left off.
- Confirmed project is greenfield; no code yet.
- Decisions/architecture/mistakes split into sibling files in this folder.

### 2026-06-27 — Session 2 (Stage 1 build)
- Scaffolded Next.js 16 + TS + Tailwind v4 via create-next-app. Gotcha: folder name `Product_compass` has capitals/underscore → npm name error; scaffolded into a valid-named temp subdir then moved files up. create-next-app also writes a stub `CLAUDE.md`(`@AGENTS.md`)+`AGENTS.md` — removed, kept the real CLAUDE.md.
- Warm Clay tokens added in Tailwind v4 `@theme` (globals.css); fonts via next/font; landing page proves it.
- Added supabase client (anon), compass_uid helper, env files.
- Verified: `npm run build` clean, dev server 200, tokens + fonts present in compiled HTML/CSS.
- User filled `.env.local` with real keys; fixed Supabase URL (had stray `/rest/v1/`). User ran `seed.sql` → 50 roles confirmed. Stopped here; Stage 2 starts next session.

### 2026-06-28 — Session 3 (Stage 2 + Stage 2.5)
- **Stage 2 (roles browse + detail):** built types/band/freshness helpers, server reads, `/roles` list with archetype filter + "hide disguised" toggle, `/roles/[id]` detail (JD, score+signals, freshness, crowd response, warm path), loading + empty + not-found states. Colors map to meaning (sage/honey/brick).
- **Data reality check:** journal claimed "50 seeded" but live `count(*)` = 0 — the seed never landed in this project. Replaced my 20 placeholders with the user's **50 India-market roles** (`scripts/roles-data.mjs`), regenerated `seed.sql`.
- **RLS bug (the one that bit the user):** after the user inserted 50 rows via SQL editor, `/roles` still showed "No roles yet". Cause: RLS enabled on `roles` with **no policies** → anon key reads return empty (no error). Fixed by adding a public SELECT policy (`scripts/roles-rls-policy.sql`). User ran it → anon now sees 50. Logged to PAST_MISTAKES.
- **Stage 2.5 (optional onboarding + personalised ranking):** skippable Q1–Q4 questionnaire (conditional Q3 "Not sure"→archetype mapping with live insight), saved to localStorage; pure-JS `scoreRole` (archetype 50 + location 20 + real_pm 0–30 + freshness boost), Top-matches/View-all split, fit tags + reason chips. Stage 2 filters kept on top. Disguised (<40) roles capped at "partial" fit so they never appear as top matches (product-thesis correctness). Switched personalisation to SSR-first (browse mode pre-hydration) to preserve server rendering.
- **Verified:** tsc + build clean; `/roles` SSR = 50 cards + Personalise CTA; scoring/ranking/derive validated with a standalone test; user confirmed it works in-browser. Positioning & tracking deliberately untouched.

### 2026-06-28 — Session 4 (Stage 3 manual positioning + Stage 4 live API)
- **Stage 3 (manual Positioning Engine + Fit read, NO AI):** "My Experience" form saved once to localStorage (`compass_experience`); a role-detail "Position me" panel assembles the positioning prompt (from CLAUDE.md's AI rules → brief shape `{lead_story, reangled_metrics[], background[], pitch_60s}`), Copy button, paste-JSON-back box; `parseBrief` survives ```json fences + surrounding chatter; brief shown as 4 sections + persisted per role (`compass_brief:<roleId>`). **Fit read** = pure-JS `computeFitRead`: buckets the JD into PM competency themes, returns a rough % match + the "framable 30%" not yet covered. Note: there was no literal "positioning prompt template" in the repo — CLAUDE.md only defines the constraints + brief shape; built the prompt faithfully from those (flagged to user to confirm wording).
- **Gotcha caught in build:** first draft used dynamic Tailwind classes (`bg-${tone}-soft`) in FitReadView — Tailwind v4 JIT can't generate from interpolated strings → would render unstyled. Fixed with a static class map. (See PAST_MISTAKES.)
- **Verified Stage 3:** tsc + build clean; transpiled the real `positioning.ts` and ran it through Node — prompt assembly, fit read (79% on a test role, correct covered/framable split), and all 4 parse cases (clean / fenced+chatter / garbage / broken JSON) passed.
- **Stage 4 (live Anthropic call on top, manual kept as fallback):** loaded the `claude-api` skill first (confirmed model id / endpoint / headers — not from memory). Built `src/app/api/position/route.ts` — server-only, raw `fetch` to `api.anthropic.com/v1/messages` (`anthropic-version: 2023-06-01`, `x-api-key`), `claude-haiku-4-5`, `max_tokens 1024`, reuses `buildPositioningPrompt`+`parseBrief`. Per-process 15-call counter (429 + warning when hit); validation 400s don't spend a call; errors sanitized (never echo key/raw body). Wired the panel: **"Position me" now calls the route and auto-fills the brief**; **"Paste it in manually"** drops to the Stage-3 flow; loading/error/low-calls UI.
- **Verified Stage 4 end-to-end:** one real Haiku call returned a valid 4-field brief; counter went 15→14→13 (only the real call counted; two validation-400s didn't). **Key safety proven:** grep of `.next/static` found neither the key value nor the string `ANTHROPIC_API_KEY` anywhere in the client bundle; referenced only in the server route; route has no `"use client"`.
- **User Q on the €5 credit:** confirmed live "Position me" draws that Anthropic account's credit, but ≈€0.003/run (full 15-call cap ≈ €0.04). Console spend-cap + git/Vercel deploy deferred to a later session by the user. Stopped here.

### 2026-06-29 — Session 5 (Stage 5: Tracking page + status strip + nudges + warm/cold path)
Brainstormed → spec (`docs/superpowers/specs/2026-06-29-stage5-tracking-design.md`) → built. **Features implemented (for the PRD):**
- **Mark as Applied** (`ApplyButton`, role-detail header) → upserts to Supabase `applications` keyed by `compass_uid`; flips to a "Tracking · <status> → View in Tracking" confirmation once applied.
- **Dedicated `/tracking` page** (client) listing every applied role, newest-first; loading/empty/error/success states. Reachable via a new **"Tracking" nav link** on the roles page header.
- **5-step status strip** (`StatusStrip`): Applied → Seen → Shared with HM → Shortlisted → Closed. Tap any stage to set it (manual advance — no real "Seen" signal in v1); **Closed confirms first**; saving spinner; static Tailwind class map (no interpolation, per PAST_MISTAKES).
- **Follow-up nudge** (`computeFollowUpNudge`, pure JS): fires only at **Seen** when days-since-`status_changed_at` ≥ `crowd_response_days` (fallback 5) → "Good time for a light follow-up."
- **Closed → 3–4 similar live roles** (`getSimilarLiveRoles`): same archetype, `is_live`, exclude current, best `real_pm_score` first; graceful empty fallback to /roles.
- **Warm/cold path** (`WarmPathIntro`): warm → "Ask for an intro" + copyable **template** pre-drafted message (NO AI; personalised from `compass_experience`, prompts to add experience if empty). Cold → "Members typically hear back in ~X days. Follow up by day X or move on." (X = `crowd_response_days`).
- **Persistence:** all status via Supabase `applications` (`scripts/applications-table.sql`), keyed by `owner_key = compass_uid` → survives reloads.

**Decisions / adaptations vs the user's literal Stage 5 instructions (for PRD honesty):**
- Storage = **Supabase** (user chose over my localStorage recommendation). RLS is **permissive** (anon r/w), rows filtered by `owner_key` client-side = *filtering, not isolation*; acceptable as we store only role-status. Documented in the SQL + spec. (v2: Supabase Auth + owner-scoped RLS.)
- Strip + nudges live on **`/tracking` only**; role-detail page gets just the Apply button + link (per user choice).
- "Sits at Seen for a while" concretised to **time vs `crowd_response_days`**; "similar" concretised to **archetype + live + score**; "pre-drafted message" = **template, no AI** (zero credits).
- Initially **dropped** the optional "simulate seeded progress" (user picked manual-advance-only), which made the time-based Seen nudge invisible without SQL. **Revised on user feedback:** added a small, clearly-labelled **"Demo: simulate a week passing"** control (shown only at Seen until the nudge fires) — `backdateStatusChange()` shifts `status_changed_at` back 7 days per click and persists; the nudge then appears in-UI, no SQL needed. (SQL backdate still documented in `applications-table.sql` as an alternative.)

**Post-build fixes (user testing, same session):**
- **Bug:** "Draft an intro request" (WarmPathIntro) showed even on **Closed** applications. Fixed — warm/cold hint now renders only while the application is open (`!isClosed`); Closed shows only the similar-live-roles section.
- Added the demo backdate control above (`FastForward` button in `TrackingCard`, `backdateStatusChange` in `applications.ts`). tsc + build re-verified clean.

### 2026-06-29 — Session 6 (Stage 6: deploy to Vercel + README)
- **README** rewritten from the create-next-app stub → problem / hypothesis / core flow / stack / how-to-test / one-line decision log / v1 security note (no-RLS-isolation). Committed.
- **git:** initialized (`main`), verified `.env.local` is gitignored *before* committing (only `.env.example` placeholders tracked), first commit `ea5f8e4`. Created **private** GitHub repo via `gh` (`shwey13fra/product-compass`) and pushed.
- **Vercel:** user imported the repo via the dashboard (walked them click-by-click), added the 3 env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY` server-side). Deployed live → **https://product-compass-tau.vercel.app**.
- **Live verification (server-side, via fetch):** homepage 200 + CTA; `/roles` SSRs all **50 roles** with scores and no error (confirms Supabase URL + anon key + RLS policy are correct in prod); role detail page renders (title/score 84·Genuine/JD/crowd/warm path/Position section); `/api/position` → 405 on GET (deployed, POST-only, key wired server-side); `/tracking` → 200. The "Mark as Applied" button + role-detail Tracking behaviour are client-rendered (post-hydration) so they don't appear in fetched SSR HTML — **expected, not a bug**; flagged the remaining interactive checks for the user to click through in a real browser.
- **Tooling available locally:** git 2.41, gh 2.92 (authed as `shwey13fra`), vercel CLI 54.1.
- **Decisions:** deploy path = GitHub→Vercel dashboard (user choice); repo = **private** (user choice — note: less useful as a public portfolio link; revisit if they want it public later).
- Stopped: user went on an errand. Interactive client-side flow on the live URL still needs their confirmation (see NEXT UP #1).

**Verified:** `npx tsc --noEmit` clean · `npx next build` clean (`/tracking` static shell + client fetch, all routes registered). **NOT yet verified end-to-end** — needs the user to run `applications-table.sql` then click through. New files: `src/lib/applications.ts`, `src/components/{StatusStrip,WarmPathIntro,TrackingCard,ApplyButton}.tsx`, `src/app/tracking/page.tsx`, `scripts/applications-table.sql`; edits: `src/lib/roles.ts` (+`getRolesByIds`,`getSimilarLiveRoles`), `src/app/roles/[id]/page.tsx`, `src/app/roles/page.tsx`.

### 2026-06-30 — Session 7 (Stage 7: login + admin + private referral collaboration)
Read CLAUDE.md + security rules → mapped the system (config/supabase/applications/roles/types + RLS scripts) → plan mode → one architecture question (admin-in-RLS) → **`is_admin()` SQL fn** chosen → ExitPlanMode approved → built. **The load-bearing reconciliation:** the existing anonymous `applications`/`compass_uid` track + public `roles` read stay UNCHANGED; auth-based RLS applies only to the NEW referral tables + locking `roles` writes to admins — this is how "turn ON RLS" and "keep the user side working without login" coexist.
- **DB (`scripts/stage7-auth-referrals.sql`, idempotent):** `is_admin()` (email allow-list, mirrors `ADMIN_EMAILS`) + `current_email()`; `profiles` + `handle_new_user` trigger; `roles` += `is_referral`/`referrer_email`, public SELECT kept, admin-only insert/update/delete; `referral_applications` (referee_id, referrer_email, status, **comment_count/last_comment_at**) RLS = referee OR referrer-by-email OR admin; `comments` RLS = **referee/referrer ONLY, no `is_admin()` branch** (admins structurally blocked) + a SECURITY DEFINER `bump_comment_count` trigger so admins still see *that* a thread exists; `application_reads` (own-rows) for the unread dot.
- **Auth:** `src/config.ts` `ADMIN_EMAILS`+`isAdminEmail`; `supabase.ts` explicit auth opts (persist/PKCE/detectSessionInUrl); `src/lib/auth.ts` (`signInWithEmail`, `signOut`, `useUser`, `useIsAdmin`); `src/app/signin` + `src/app/auth/callback`; `src/components/AuthNav.tsx` (sign-in / email+sign-out + Admin link if admin + Referrals link w/ unread dot) dropped into the roles header.
- **Referral data:** `src/lib/referrals.ts` — applications CRUD, comments, reads/unread (`isUnread`/`getUnread`), `viewerRole`/`statusBadgeRole`, `getProfileEmails`, admin `adminCreateReferralRole`.
- **User side:** `Role` += `is_referral`/`referrer_email` (types + `ROLE_COLUMNS`); `ReferralBadge` on `RoleCard` + role-detail header; role-detail branches `ReferralApplyButton` (sign-in-gated, opens shared thread) vs the existing anonymous `ApplyButton`.
- **Admin view (`src/app/admin`):** gated (loading/sign-in/not-authorized/admin); post-referral-role form (validated); referral overview (role · referee email via profiles · referrer email · status select-to-override · "Thread · N messages" from `comment_count`, never contents).
- **Collaboration:** `src/app/referrals` (index, unread dots, viewer-role label) + `src/app/referrals/[id]` (shared `StatusStrip` wired to `setReferralStatus`; private thread = referee/referrer chat composer; **admins see a Lock card "hidden from admins" + the count only**; `markRead` on open/post; `// TODO(v2): email notifications`).
- **Verified:** `tsc --noEmit` clean · `next build` clean (new routes `/admin /signin /auth/callback /referrals /referrals/[id]` registered). **Key safety:** no `service_role` in `src`; client reads only `NEXT_PUBLIC_*`; `ANTHROPIC_API_KEY` server-route only. **NOT yet user-verified** — needs the SQL run + Supabase email auth enabled + real admin email; RLS "admin can't read comments" proof is part of the three-persona test (NEXT UP #0).

### 2026-07-01 — Session 8 (Stage 7 deploy + verify: auth debugging, referrer-driven status, warm thread)
Resumed to verify Stage 7. Migration run by the user (success). Committed + pushed all Stage 7 work; then debugged the auth flow live until sign-in + admin worked, and added a product refinement. All changes pushed to `main` and auto-deployed to the recreated Vercel project. Commit chain: `3309b71` → `ae25dbb` → `b00de9d` → `b8984f5` → `065360f`.
- **Landing page rebuilt** (`src/app/page.tsx`): dropped the Stage-1 dev-proof card (swatches/"Stage 1" copy); real hero + value pillars + `AuthNav` header (was auth-unaware and dead-ended a signed-in admin). Decision: **nav-link-only** for admins (no auto-redirect); landing sign-in returns to `/roles` (`AuthNav` maps `/` → `/roles`).
- **Deploy saga:** old `…-tau` Vercel project's GitHub link broke ("upgrade to Pro / add team members" = wrong turn into Vercel *Teams*, NOT needed). Repo is **public + personal account** → free Hobby deploy, no restriction. User **recreated the Vercel project** by fresh import → new URL **https://product-compass-lilac.vercel.app** (env vars re-added). Journal live-URL refs updated.
- **Auth debugging (the big one), in order:**
  1. Magic link landed on `/?code=…` (Supabase **Site-URL fallback** because the redirect wasn't allow-listed) → session never exchanged → no Admin link. Added redirect URLs `…/**`.
  2. Magic links are fragile with Gmail (link pre-scanned/consumed) + PKCE needs same browser → **switched to typed OTP code** (`verifyEmailOtp` via `supabase.auth.verifyOtp({type:"email"})`; two-step sign-in page). Magic link kept as fallback.
  3. Supabase generated **8-digit** codes (configurable length) but the form hardcoded 6 → **accept 6–10 digits**.
  4. Free built-in email **can't edit templates** (banner: "Set up custom SMTP to edit templates") → set up **Gmail custom SMTP** (App Password) → edited "Magic link or OTP" template to include `{{ .Token }}`.
  5. **"no other email works" root cause:** new users got the **"Confirm signup"** template (link only, no code, and clicking errored) because **"Confirm email" was ON**; existing `shwetaswain13november@` got the code template. Fix: **turned "Confirm email" OFF** → all new emails now get the code. (Testing tip logged: use `+alias` emails to funnel every persona's code into one inbox.)
- **Admin post-role bug:** `null value in column "crowd_response_days" … not-null constraint` — `adminCreateReferralRole` omitted NOT NULL cols. Fixed: defaults `real_pm_signals: []`, `crowd_response_days: 7` (`b8984f5`).
- **Product refinement (user-requested, confirmed via AskUserQuestion):** referral status is no longer a free-for-all. `allowedStatusesFor()` + `StatusStrip` `allowed`/`hint` props → **referrer drives Seen/Shared/Shortlisted/Closed; referee only Closed; admin overrides.** Anonymous `/tracking` strip unchanged. Plus a **warm, role-aware empty-thread prompt** + starter placeholder (`referrals/[id]`). Decision logged in `DECISIONS.md`.
- **Verified live:** sign-in via OTP works; Admin link shows for admin; `/roles`, `/signin` (OTP flow), landing all serve latest on the lilac URL; `tsc`+`build` clean each commit. **Still pending:** the full three-persona referral collaboration + RLS "admin can't read comments" proof, and the deferred Stage 5 live-flow confirm (see NEXT UP 1–2).

### 2026-07-07 — Session 9 (Stage 8: job ingestion from legal sources)
User asked to "start at step 8" → clarified there was no Stage 8; it's a **new feature** (job ingestion). Ran brainstorming → spec → writing-plans → built inline via 10 TDD tasks.
- **Two findings that shaped the design:** (1) **no rule-based real-PM scorer existed** — the 50 seed scores were hand-authored in `roles-data.mjs`; Stage 8 required building `src/lib/realPmScore.ts` from scratch (reused the `THEMES` keyword idea from `positioning.ts`). (2) **`roles` is admin-write-locked by RLS** (stage7 SQL) and `service_role` is banned → the ingest route **forwards the admin's Supabase JWT** (per-request client) so writes pass RLS. Both confirmed by reading the code before building.
- **Product decision (user):** the 50 curated roles are **dummy data** — tag them `source='seed'`, badge "Sample", delete later once ingestion works. So no cap-ranking needed; the `source` column marks sample vs real.
- **Cost check (user asked):** a sync is **free** — Greenhouse/Lever public+free, Adzuna free tier (rate-limited, never billed), **zero Anthropic credits** (rule-based scorer). Adzuna capped at 50 rows/sync.
- **Built:** schema SQL + `Role` fields; `realPmScore.ts` (+archetype); `ingest/{types,normalize,sources,pipeline}.ts`; `POST /api/ingest`; `SourceBadge`/`sourceLabel`; `ApplyOutButton`; admin "Sync jobs now" panel. Smoke-test source = **`stripe`** (Greenhouse). Added `tsx` devDep for standalone TS tests.
- **Verified:** 4 tsx test files green (scorer/normalize/sources/pipeline); `tsc`+`next build` clean; `/api/ingest` registered. **Live integration probe against the real Stripe board: 495 jobs → 24 PM after filter, scores 32–92, no HTML leak** (caught + fixed a `stripHtml` order bug pre-ship: decode entities before stripping tags, since Greenhouse content is entity-encoded). All committed to `main`.
- **NOT yet done (user's live smoke test):** run `scripts/stage8-job-ingestion.sql`; set `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`; `/admin` → "Sync jobs now". That live write also proves the JWT/RLS path.
