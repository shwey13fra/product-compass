# Stage 5 — Tracking page, status strip, nudges & warm/cold path

**Date:** 2026-06-29 · **Scope:** STAGE 5 ONLY (v1 scope #4 status strip + #5 warm path + #6 cold-path stat folded in)

## Goal
A PM marks a role **Applied** → it persists to Supabase keyed by `compass_uid` → it appears on a
dedicated **/tracking** page with a 5-step status strip (Applied → Seen → Shared with HM →
Shortlisted → Closed), follow-up nudges, and a warm-path/cold-path hint. Everything survives reload.

## Decisions (locked with user)
- **Storage:** Supabase `applications` table (not localStorage), keyed by `owner_key = compass_uid`.
- **Strip location:** `/tracking` page **only**. The role-detail page gets just a "Mark as Applied"
  button that links to Tracking.
- **Seen nudge threshold:** time-at-`seen` > `role.crowd_response_days` (fallback ~5 days if null).
- **Closed → similar roles:** same archetype, `is_live = true`, exclude the closed role, rank by
  `real_pm_score`, take top 3–4.
- **Demo progression:** manual advance only (no simulate button). Time-based nudge demoed via a
  documented one-line SQL backdate of `status_changed_at`.
- **Warm-path intro:** template-based pre-drafted message (NO AI / zero credits).

## Honest constraint (no real isolation)
v1 has no auth. RLS on `applications` will be **permissive** and rows are filtered by `owner_key`
client-side. This is filtering, **not** privacy — anyone with the anon key could read all rows. It is
acceptable here because we store only role-status, nothing sensitive. Stated in the SQL + README.

## Data — Supabase `applications` table
`scripts/applications-table.sql` (user runs it in the Supabase SQL editor, same flow as `roles`):

| column | type | notes |
|---|---|---|
| id | uuid pk, default gen_random_uuid() | |
| owner_key | text not null | = compass_uid |
| role_id | text not null | references roles.id |
| status | text not null | applied \| seen \| shared_with_hm \| shortlisted \| closed |
| status_changed_at | timestamptz not null default now() | drives the Seen nudge |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

- **Unique (owner_key, role_id)** → one application per role per browser; upsert on conflict.
- RLS **enabled** + permissive anon policies (select/insert/update where true). Commented as above.

## Components & files
- `src/lib/applications.ts` (new) — data + pure logic:
  - `ApplicationStatus` type, `STATUS_STEPS` ordered `[{key,label}]`.
  - `getApplicationsForOwner(ownerKey)` → `Application[]`.
  - `getApplication(ownerKey, roleId)`.
  - `setStatus(ownerKey, roleId, status)` — upsert, stamps `status_changed_at` + `updated_at`.
  - `computeFollowUpNudge(app, role)` (pure JS) → message when `status==='seen'` and
    days-since-`status_changed_at` > `crowd_response_days ?? 5`, else null.
  - Warm/cold-path rendering is owned by the `WarmPathIntro` component (uses `has_warm_path`,
    `warm_path_note`, `crowd_response_days`); the cold-path "follow up by day X" uses
    X = `crowd_response_days`. No separate hint helper in the lib.
- `src/lib/roles.ts` — add `getSimilarLiveRoles(role, limit=4)`: archetype match, `is_live=true`,
  `id != role.id`, order by `real_pm_score` desc, limit.
- `src/app/tracking/page.tsx` (new, client) — reads `compass_uid` → loads applications → fetches the
  matching roles → renders one card per applied role. Handles loading / empty / error / success.
- `src/components/StatusStrip.tsx` (new, client) — 5 chips, current highlighted (Warm Clay semantic
  colors via a **static class map** — no interpolated Tailwind, per PAST_MISTAKES). Advance to next
  status; "Closed" confirms first (destructive). Toast on change.
- `src/components/TrackingCard.tsx` (new, client) — per-role wrapper: header (title/company, link to
  detail) + StatusStrip + follow-up nudge + warm/cold hint + (when closed) 3–4 similar live roles.
- `src/components/WarmPathIntro.tsx` (new, client) — reads `compass_experience`; warm path →
  "Ask for an intro" + pre-drafted template message + Copy (prompts to add experience if none).
  Cold path → "Members typically hear back in ~X days. Follow up by day X or move on."
- `src/components/ApplyButton.tsx` (new, client) — on role detail: "Mark as Applied"; if already
  applied shows "Tracking ✓ — View" linking to `/tracking`.
- `src/app/roles/[id]/page.tsx` — mount `ApplyButton`.
- `src/app/layout.tsx` (or nav) — add a "Tracking" nav link so the page is reachable.

## Data flow
1. Detail page (server) renders role unchanged. `ApplyButton` (client) reads `compass_uid`, checks if
   an application exists, renders CTA or "Tracking ✓".
2. Click "Mark as Applied" → upsert `{owner_key, role_id, status:'applied'}` → button flips, toast.
3. `/tracking` (client) reads `compass_uid` → `getApplicationsForOwner` → fetch roles by id → cards.
4. Advancing status on a card → `setStatus` (stamps `status_changed_at`) → re-render + toast.
5. `computeFollowUpNudge` + warm/cold hint + similar-roles (when closed) derive from current data.
6. Reload re-queries Supabase → state persists via `owner_key`.

## States to handle
loading (querying Supabase), empty (no applications / no experience for intro), error (Supabase
failure → friendly message, not a crash), success. Mobile-first, 44px targets, confirm on "Closed",
toast feedback.

## Pre-drafted intro template (no AI)
> Hi [contact], I saw [company] is hiring a [title]. I'm [experience.headline] — it looks like a
> strong fit and I'd love a quick intro to the team if you're open to it. Happy to share more.
> Thanks, [experience.name]

Falls back to a prompt to fill the experience form if `compass_experience` is empty.

## Prove (acceptance)
- `npx tsc --noEmit` clean · `npx next build` clean.
- User runs `scripts/applications-table.sql` in Supabase.
- End-to-end: Mark Applied on a role → it appears on `/tracking` → advance through statuses →
  **reload persists** → backdate `status_changed_at` (documented SQL) to see the Seen follow-up nudge
  → set to Closed → 3–4 similar live roles appear → warm-path role shows copyable intro; cold-path
  role shows crowd stat + follow-up-by-day hint.

## Out of scope (v2 seams)
Auto-pull/seen-detection from real ATS, referral marketplace, accounts/login, per-user RLS isolation,
AI-generated intros. Status transitions are user-driven (no real "Seen" signal in v1).

## Notes
- Repo is not git-initialized, so this spec is saved but not committed.
- `getSimilarLiveRoles` and application reads use the existing anon `supabase` client (works on the
  client side; `/tracking` is a client component).
