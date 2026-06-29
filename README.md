# Product Compass

Helps Product Managers **position themselves for a specific role's context** — the gap no job
platform fills. Pick a curated real-PM role (or paste a JD), get a tailored **positioning brief**,
then track the application with a light post-apply status layer.

## The problem
Job boards optimize for *finding* roles, not for *winning* the one in front of you. A PM staring at a
JD has to guess which of their wins to lead with, how to re-angle their metrics, and what to play down
— and once they apply, they're flying blind on whether to follow up or move on. Generic "tailor your
resume" tools don't understand PM archetypes (AI, growth, platform, b2b…) or the difference between a
*genuine* PM role (owns discovery + outcomes) and a *disguised* one (delivery + ticket throughput).

## The hypothesis
If we (1) score roles for how "real-PM" they actually are, (2) generate a role-specific positioning
brief from the PM's own experience, and (3) add a lightweight status tracker with timely follow-up
nudges, a PM can present themselves far more sharply for the specific role — and spend their energy on
the applications worth pursuing.

## Core flow
1. **Browse curated roles** — ~50 seeded roles, each scored 0–100 for whether it's a genuine vs
   disguised PM role, with a freshness flag. Filter by archetype; optionally answer a short onboarding
   to get personalized ranking.
2. **Fit read** — a rough % match of your experience against the JD, plus the "framable 30%" you don't
   yet cover (pure JS, no AI).
3. **Generate a positioning brief** — `{ lead_story, reangled_metrics[], background[], pitch_60s }`.
   Runs live via Claude server-side, or paste-in manually with zero credits.
4. **Mark as Applied** → the role lands on the **Tracking** page with a status strip
   (Applied → Seen → Shared with HM → Shortlisted → Closed).
5. **Follow-up nudge** — a role sitting at *Seen* past its crowd-response window prompts a light
   follow-up. On *Closed*, it suggests 3–4 similar live roles. Warm-path roles offer a pre-drafted
   intro request; cold-path roles show the crowd response-time stat.

Everything post-apply persists across reloads via an anonymous `compass_uid` (no login in v1).

## Stack
Next.js (App Router) + TypeScript + Tailwind v4 + lucide-react, deployed on **Vercel**.
Supabase (Postgres) for the shared roles table and per-user applications. Positioning AI runs in a
server-side route handler (`/api/position`) that holds the Anthropic key — it never reaches the client.

## How to test
1. **Supabase:** run `scripts/seed.sql`, `scripts/roles-rls-policy.sql`, and
   `scripts/applications-table.sql` in the Supabase SQL editor.
2. **Env:** copy `.env.example` → `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `ANTHROPIC_API_KEY` (server-side only).
3. `npm install && npm run dev` → open http://localhost:3000/roles.
4. Walk the core flow: filter roles → open one → fit read → generate a brief (live or manual) →
   **Mark as Applied** → open **Tracking** → advance the status strip → reload (state persists).
   To see the time-based follow-up nudge without waiting, set a card to *Seen* and click
   **"Demo: simulate a week passing."**

## Decision log (one line each)
- **No auth in v1** — anonymous `compass_uid` (UUID in localStorage) as `owner_key`; add Supabase Auth
  + RLS in v2.
- **AI is hybrid + credit-safe** — manual paste-in built first (zero credits), live Claude call layered
  on top, server-side only, with a per-process call cap.
- **Positioning prompt + parser are one source of truth** — shared by the live route and manual path.
- **Match scoring & fit read are pure JS, not AI** — deterministic, free, testable.
- **Tracking storage is Supabase** keyed by `compass_uid` so status survives reloads.

## Security note (v1)
v1 has **no authentication**. The `applications` table has RLS enabled but with permissive policies;
rows are filtered by `owner_key` on the client — that's *filtering, not isolation*. Anyone with the
public anon key could read all rows, so **nothing sensitive is stored** (role-status only). The
Anthropic key lives only in Vercel's server-side env, never in the client bundle. v2 adds Supabase Auth
+ owner-scoped RLS before storing anything private.
