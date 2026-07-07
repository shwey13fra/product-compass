# Product Compass — Product Requirements Document

> Living PRD. Reflects what is actually built and deployed, not aspirations.
> **Live:** https://product-compass-lilac.vercel.app · **Repo:** https://github.com/shwey13fra/product-compass
> Last updated: 2026-07-01 (end of Session 8).

---

## 1. Problem

Job platforms help you *find* and *apply to* roles. None help you **position yourself for a specific role's context** — reframing your real experience so it lands for what *that* team actually needs. PMs in particular are judged on whether they own discovery and outcomes vs. just delivery and coordination, and job listings rarely make that distinction visible.

## 2. Hypothesis

If a PM can turn their experience into a **tailored positioning brief** for one specific, vetted role — and see honestly whether that role is "real PM" work — they'll apply with sharper, more credible framing and waste less effort on disguised roles.

## 3. Core principle

Positioning works for everyone; **status** is the warm-path bonus; **crowd/freshness** is the cold-path consolation. No single feature pretends to be the whole answer.

## 4. Personas

- **Applicant (anonymous PM)** — browses roles, positions themselves, tracks applications. No login required.
- **Referee (signed-in applicant)** — applies to a referral role; collaborates privately with a referrer.
- **Referrer (signed-in)** — tagged on a referral role; drives the hiring-side status and chats privately with the referee.
- **Admin** — posts referral roles and moderates; can see *that* a private thread exists but **never its contents**.

---

## 5. Features

Status legend: ✅ built + live-verified · 🟡 built + pushed, not yet click-verified end-to-end.

### 5.1 Positioning Engine (HERO) ✅
- Select/paste a role → generate a **positioning brief** = `{ lead_story, reangled_metrics[], background[], pitch_60s }`.
- **Two paths:** live AI (server-side route, `claude-haiku-4-5`, ≈ €0.003/run) **and** a manual paste-in fallback that works with **zero credits**.
- One-time "My Experience" profile feeds both paths; briefs persist per role.
- Guardrails: API key server-only; JSON-only output; per-process 15-call budget cap; validation errors don't spend a call; never fabricate — change portrayal, not facts.

### 5.2 Curated roles + real-PM scoring ✅
- ~50 seeded India-market PM roles (illustrative postings on real company names — not live listings).
- **Real-PM score 0–100** with bands: 70+ genuine · 40–69 verify · 0–39 disguised. Signals + a **freshness** flag.
- Filter by archetype; "hide disguised" toggle; role detail with JD, score + signals, crowd-response, warm-path.

### 5.3 Personalization / onboarding ✅
- Skippable Q1–Q4 questionnaire → pure-JS ranking (archetype + location + real-PM score + freshness). Top-matches vs. View-all; disguised roles capped so they never top-rank.

### 5.4 Fit read ✅
- Pure-JS **% match** + the "framable 30%" + real-PM verdict (JD theme-bucketing; no AI; instant and free).

### 5.5 Tracking + status (anonymous) 🟡
- **Mark as Applied** → Supabase, keyed by anonymous `compass_uid` (no login).
- `/tracking` page; **5-step status strip** (Applied → Seen → Shared with HM → Shortlisted → Closed); persists across reloads.
- **Follow-up nudge** (days since status vs. `crowd_response_days`); a labelled "Demo: simulate a week" control; **Closed → 3–4 similar live roles**.
- *Final interactive click-through on the live URL still pending.*

### 5.6 Warm / cold path ✅
- Warm: "Ask for an intro" + a copyable, pre-drafted template message (no AI, personalized from experience).
- Cold: "members typically hear back in ~X days — follow up by day X or move on."

### 5.7 Authentication ✅
- Passwordless **8-digit OTP code** sign-in (typed code; magic link kept as fallback).
- Delivered via **Gmail custom SMTP**; email confirmation disabled (the code proves ownership).
- Anonymous browsing/positioning/tracking works **without** login — sign-in only gates referral + admin.

### 5.8 Admin view ✅
- Admins identified by `ADMIN_EMAILS` (`src/config.ts`) mirrored by a Postgres `is_admin()` function.
- Post a **referral role** (badged in the list; tag a referrer email).
- Overview of referral applications: status + **"Thread · N messages" count, never the contents**.

### 5.9 Private referral collaboration 🟡
- Applying to a referral role (sign-in-gated) creates a **shared application** + a private thread between **referee + referrer only**.
- **Role-permissioned status:** referrer drives Seen / Shared with HM / Shortlisted / Closed; referee can only mark Closed (withdraw); admin overrides any.
- Warm, role-aware empty-thread prompt + starter placeholder; in-app unread dot.
- **Security:** admins are *structurally* blocked from reading comments — enforced by Postgres RLS, not app code.
- *Full three-persona flow + the "admin can't read comments" RLS proof still to be click-verified.*

### 5.10 Job ingestion from legal sources (Stage 8) 🟡
- Admin-triggered ingest (`POST /api/ingest`, "Sync jobs now") pulls real PM roles from **Greenhouse** + **Lever** (public, no auth) + **Adzuna** (India breadth, free keys). No LinkedIn/Naukri scraping.
- PM-title filter (excludes project/program manager); normalized into the `roles` schema with `source`, `external_id`, `apply_url`, `ingested_at`; **rule-based real-PM scorer** (pure JS, **no AI/credits**); best-effort archetype inference.
- Dedupe by `source:external_id` + cross-source company|title|location; upsert; stale ingested roles → `is_live=false`. Ingested roles are **cold-path** (Apply links OUT; fit read + crowd stat), badged by source; the 50 seed roles are tagged `source='seed'` (badged "Sample", deletable).
- **Write path:** the route forwards the admin's Supabase JWT so writes pass the admin-only `roles` RLS — no `service_role`. Adzuna keys server-env only.
- *Live sync click-through (run the SQL, set Adzuna keys, "Sync jobs now") still pending user verification.*

---

## 6. Design — "Warm Clay"

Tailwind v4 `@theme` tokens (never hardcoded hex): warm neutrals, one terracotta primary action per view, semantic color only for meaning. Inter (UI) + Plus Jakarta Sans (headings). Every state handled: loading / empty / error / success. Mobile-first, 44px touch targets, confirm destructive actions.

## 7. Architecture & security

- **Stack:** Next.js 16 (App Router, `src/`, Turbopack) · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres) · deployed on Vercel. Server Components by default.
- **Two-track data model:** the anonymous `compass_uid` track + public `roles` read stay open; auth-based **RLS** applies only to the referral tables and locks `roles` *writes* to admins. This is how "turn on RLS" and "keep the user side working without login" coexist.
- **Security:** Supabase **anon key only** (no service-role anywhere); Anthropic key in the **server route only**; `.env.local` gitignored (only `.env.example` placeholders tracked). Comments RLS references only referee/referrer, so admins cannot read thread contents.

## 8. Out of scope (v2 seams)

Auto-pull live jobs, ATS integration, "why-rejected" feedback, referral marketplace, email notifications on thread/status changes, per-user AI quota, owner-scoped RLS on the anonymous tracking table, accounts beyond passwordless email.

## 9. Verification status

- **Verified live:** roles browse/scoring (SSR of all 50 in prod), positioning (real brief returned; key absent from client bundle), auth OTP sign-in + admin gate, admin referral-role posting.
- **Pending click-through:** (1) the Stage 7 three-persona referral flow + RLS "admin can't read comments" proof; (2) the Stage 5 live interactive tracking flow.

## 10. Near-term roadmap

1. Finish the three-persona referral verification (use `+alias` emails; keep admin ≠ referee/referrer for a clean RLS proof).
2. Confirm the Stage 5 live tracking flow on the deployed URL.
3. Revision/polish pass: cap "Top matches" size, confirm-on-Reset, resolve warm/cold duplication between role-detail and tracking cards, optional `?code=`-on-`/` auth hardening, optional 6-digit OTP length.

---

## Decision log (one line per major choice)

- Sign-in uses a typed **OTP code**, not the magic link — Gmail pre-scans/consumes links and PKCE needs the same browser; app accepts 6–10 digits.
- **Confirm-email OFF + Gmail custom SMTP** — redundant for passwordless OTP; SMTP also unlocks template editing and higher send limits.
- **Role-permissioned referral status** — maps status to who has the information (referrer drives the pipeline); UX guardrail, RLS is the real gate.
- Landing page is a **shared entry** with an auth-aware header (no auto-redirect for admins); repo public + personal account for free Vercel Hobby deploys.
- Admins enforced in Postgres via `is_admin()`; **comments RLS never references `is_admin()`** so admins are structurally blocked from thread contents.
- Positioning: build the **manual fallback first**, live AI on top; both reuse one prompt + one parser.
- Real-PM score and fit read are **pure JS** (free/instant); disguised roles are capped so they never sell as top matches.
- No auth in the anonymous core; **anonymous `compass_uid`** as `owner_key` — ship faster, add auth + owner-scoped RLS in v2.
