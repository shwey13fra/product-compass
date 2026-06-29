# Session Journal — Product Compass

> **READ THIS FIRST every session.** Top section = where we left off. Append a new
> entry at the end of each session. Keep "Current State" and "Next Up" honest and current.

---

## ▶ CURRENT STATE (last updated: 2026-06-29, end of session 5)

**Phase:** STAGE 2 + 2.5 ✅ · STAGE 3 (manual Positioning + Fit read) ✅ · STAGE 4 (live Anthropic API) ✅ · **STAGE 5 (Tracking page + status strip + nudges + warm/cold path)** ✅ built, tsc+build clean — **awaiting user verify** (needs `applications` table created in Supabase first).
**Stage 5 spec:** `docs/superpowers/specs/2026-06-29-stage5-tracking-design.md`. **USER ACTION REQUIRED:** run `scripts/applications-table.sql` in Supabase SQL editor before the flow works (without it `/tracking` shows the error state — by design).
**Env:** `.env.local` has real keys. Supabase project = `https://mfqsledvtemerllqawgt.supabase.co` (bare URL, no `/rest/v1/`). **`ANTHROPIC_API_KEY` is set** (108 chars) — server-only, no `NEXT_PUBLIC_` prefix.
**Data:** `roles` table = **50 India-market roles** (illustrative postings on real company names, NOT live listings). Source of truth: `scripts/roles-data.mjs` → `node scripts/gen-seed-sql.mjs` regenerates `seed.sql` → run in Supabase SQL editor.
**RLS:** `roles` has RLS **on** + a public **SELECT** policy (`scripts/roles-rls-policy.sql`). Without it the app silently shows "No roles yet".
**To resume:** run `npm run dev` → http://localhost:3000/roles → open any role → "Position me for this role" panel at the bottom. (Server NOT running between sessions — start fresh. Stale Turbopack `0xc0000142` HMR 500s → `taskkill //PID <pid> //F`, `rm -rf .next/dev`, restart.)
**Repo:** Not a git repo yet.
**Stack live:** Next.js 16.2.9 (App Router, `src/`, Turbopack) · React 19 · TS · **Tailwind v4** (`@theme` tokens, no config file) · lucide-react · @supabase/supabase-js v2.
**Build status:** `npx tsc --noEmit` clean · `npx next build` clean · `/api/position` registered as dynamic server route · live call verified returning a real brief.
**Budget:** live "Position me" uses `claude-haiku-4-5`, `max_tokens 1024` ≈ **€0.003/run**. Per-process counter hard-stops at **15 calls** (override `POSITION_CALL_CAP`). Manual paste-in = **zero credits**. (User asked re: €5 credit — confirmed it draws that account's credit but cost is negligible; setting a Console spend cap deferred to "later".)

**Stage 2 files:** `src/lib/types.ts` (`getBand` sage/honey/brick, `getFreshness`) · `src/lib/roles.ts` · `src/app/roles/page.tsx` (+ `loading.tsx`, `[id]/page.tsx`, `[id]/not-found.tsx`) · `src/components/RoleCard.tsx`, `role-badges.tsx`.
**Stage 2.5 files:** `src/lib/preferences.ts` (pure-JS `scoreRole`) · `src/components/OnboardingModal.tsx` · `RolesBrowser.tsx`. localStorage: `compass_preferences`, `compass_onboarding_dismissed`.
**Stage 3 files (manual positioning, NO AI):** `src/lib/experience.ts` (`ExperienceProfile` + localStorage `compass_experience`) · `src/lib/positioning.ts` (`buildPositioningPrompt`, `parseBrief` [handles ```json fences + chatter], `computeFitRead` [theme-bucket % match + framable 30%], brief persistence `compass_brief:<roleId>`) · `src/components/ExperienceForm.tsx` · `src/components/PositioningPanel.tsx` (wired into `roles/[id]/page.tsx`).
**Stage 4 files (live AI on top):** `src/app/api/position/route.ts` (server route: reads `ANTHROPIC_API_KEY`, raw `fetch` to `api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`, reuses `buildPositioningPrompt`+`parseBrief`, 15-call counter, validation 400s don't spend a call). `PositioningPanel.tsx` extended: **"Position me" = live call (default)**, **"Paste it in manually" = Stage-3 fallback** with a "Back to live positioning" link; loading/error/low-calls states.

## ▶ BLOCKED ON USER — none

## ▶ NEXT UP — START HERE NEXT SESSION

v1 scope: 1 Positioning ✅ · 2 curated roles ✅ · 3 Fit read ✅ · **4 Status strip ✅** · **5 warm-path ✅** · **6 cold-path crowd stat ✅** · 7 tracking folded in ✅. **v1 feature set is complete pending user verify of Stage 5.**
- **First next session:** confirm user ran `scripts/applications-table.sql` and the Stage 5 flow verified end-to-end. If a bug surfaces, root-cause → fix → log.
- **Then the remaining loose ends → portfolio-ready:** `git init` + first commit; deploy to **Vercel** (set `ANTHROPIC_API_KEY` + `NEXT_PUBLIC_SUPABASE_*` in Vercel env); README (problem/hypothesis/core flow/how-to-test + the no-RLS-isolation note). These were parked across sessions.
- **PRD note (user wants this tracked):** features implemented/adapted in Stage 5 are logged below in the session log + DECISIONS — pull from there when assembling the final PRD.

## ▶ OPEN QUESTIONS / BLOCKERS

- Not git-initialized (scaffolded with `--disable-git`). Init when ready to deploy to Vercel. **Stage 4 needs `ANTHROPIC_API_KEY` set in Vercel env** (server-side) before the live path works in production.
- Budget backstop deferred: set a monthly spend cap in Anthropic Console → Billing (user said "later").
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

**Verified:** `npx tsc --noEmit` clean · `npx next build` clean (`/tracking` static shell + client fetch, all routes registered). **NOT yet verified end-to-end** — needs the user to run `applications-table.sql` then click through. New files: `src/lib/applications.ts`, `src/components/{StatusStrip,WarmPathIntro,TrackingCard,ApplyButton}.tsx`, `src/app/tracking/page.tsx`, `scripts/applications-table.sql`; edits: `src/lib/roles.ts` (+`getRolesByIds`,`getSimilarLiveRoles`), `src/app/roles/[id]/page.tsx`, `src/app/roles/page.tsx`.
