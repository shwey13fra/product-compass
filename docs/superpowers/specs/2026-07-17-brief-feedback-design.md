# Stage 13 — Brief feedback (did the positioning actually help?)

> **Status:** design approved 2026-07-17.
> **Constraint:** pure JS + Supabase only. **No AI spend in this stage.**
> **Why it matters:** the Positioning Engine is the HERO of v1 and we have never
> once measured whether a brief was any good. Stage 10 instrumented *that* briefs
> get generated; this measures whether they *land*. It is also the only signal
> that could ever justify the live/`claude-sonnet-4-6` spend over the free manual
> path — right now that choice rests on nothing.

## Scope

1. `brief_feedback` table + uid-scoped RPCs.
2. Inline thumbs up/down on the positioning panel after a brief renders; a
   one-line "what was off?" appears on thumbs-down.
3. On **Mark as Applied** for a role that has a brief: one dismissible question,
   *"Did you use the positioning brief in this application?"* (Yes/No), stored on
   `brief_feedback`.
   > **`had_brief` already exists — do not rebuild it.** `ApplyButton.tsx:53` and
   > `ReferralApplyButton.tsx:68` already fire
   > `track("applied", { role_id, had_brief: loadBrief(roleId) !== null })`.
   > Only the prompt is new. `had_brief` records that a brief *existed*;
   > `used_in_application` records that it was *used* — different claims, and the
   > gap between them is the interesting number.
4. A rated brief shows its rating on revisit.
5. Admin-only `/admin/quality`: rating counts by mode (live vs manual), usage
   rate, recent thumbs-down notes.
6. Events: `brief_rated`, `brief_used_reported`.
7. **STOP** — print the checklist, user verifies before Stage 14.

**Also in scope (root fix, carried from the Stage 13 seed-roles spec):**
`adminCreateReferralRole` sets `source = 'referral'`; the booby-trapped comment
at `scripts/stage8-job-ingestion.sql:14` is corrected.

**Explicitly out of scope:** retiring the 48 seed sample roles
(`2026-07-17-retire-seed-roles-design.md`) — parked as its own stage, because it
changes what every visitor sees and deserves its own verification pass.

## Three corrections to the original ask

These change the implementation, not the intent.

### 1. "RLS: insert/update only for the owning uid" is not enforceable — and the Stage 11 pattern is the opposite of a policy

`compass_uid` is a **localStorage value the client asserts**, not a verified JWT
claim, and the anon key is public (it ships in the browser bundle). Any policy
comparing a column to a client-supplied uid can be satisfied by claiming someone
else's uid. `stage11-ai-quota-and-rls.sql:125-135` already settled this for
`applications`: **drop every policy → deny-all**, then route all access through
`SECURITY DEFINER` functions that require the caller to present the exact uid.
Its own comment states the property: *"No function lists owner_keys, so
enumeration is impossible: you can only touch rows whose uid you hold."*

`brief_feedback` follows that pattern exactly.

### 2. `rating` must be NULLABLE

Item 3's flow (Mark as Applied → "did you use it?") can fire for a user who never
rated the brief. A `not null` rating makes that row unwritable. `rating` is
therefore nullable; a row may carry a rating, a `used_in_application`, or both.

### 3. `brief_mode` needs an `'unknown'` value

`StoredBrief` is `{version, roleId, brief, fit, rawJson, savedAt}` — it has never
recorded whether the brief came from the live call or the manual paste-in. Worse,
`loadBrief` guards with `if (b?.version !== 1) return null`, so **bumping the
version to add the field would silently wipe every saved brief on every device**.
So: add `mode?: "live" | "manual"` as optional **at version 1**, and briefs saved
before this stage report `'unknown'` rather than a guess.

## Schema

```sql
create table if not exists public.brief_feedback (
  id                  uuid primary key default gen_random_uuid(),
  uid                 text not null,                    -- compass_uid (secret)
  role_id             text not null,                    -- = roles.id (no FK, mirrors applications)
  brief_mode          text not null check (brief_mode in ('live','manual','unknown')),
  rating              text check (rating in ('thumbs_up','thumbs_down')),  -- nullable: see correction 2
  used_in_application boolean,                          -- null = never asked / dismissed
  note                text check (note is null or length(note) <= 280),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (uid, role_id)                                 -- one feedback per brief; upsert target
);

create index if not exists brief_feedback_created_idx on public.brief_feedback (created_at desc);

alter table public.brief_feedback enable row level security;
-- NO anon policy → deny-all. All uid access goes via the RPCs below.

drop policy if exists "brief_feedback read admin" on public.brief_feedback;
create policy "brief_feedback read admin" on public.brief_feedback
  for select to authenticated using (public.is_admin());
```

### RPCs (`SECURITY DEFINER`, `set search_path = public`, granted to anon+authenticated)

- `rate_brief(p_uid text, p_role text, p_mode text, p_rating text, p_note text)`
  → upsert on `(uid, role_id)`; sets rating/mode/note, stamps `updated_at`.
  Clears `note` when rating is `thumbs_up`.
- `report_brief_used(p_uid text, p_role text, p_used boolean)`
  → upsert on `(uid, role_id)`; sets only `used_in_application` (leaves rating
  untouched, inserts with `rating = null` if no row exists).
- `get_brief_feedback(p_uid text, p_role text)` → the single row, or none.

Every function **requires** `p_uid` and filters by it. None accepts a "list all"
shape. Validation (enum membership, note length) is enforced in the function as
well as the check constraints — the RPC is the boundary.

## Client

| File | Change |
|------|--------|
| `src/lib/briefFeedback.ts` | **new** — typed wrappers for the three RPCs; `Result<T>` shape matching `src/lib/referrals.ts` |
| `src/lib/positioning.ts` | `StoredBrief.mode?: "live" \| "manual"` (version stays **1**); `saveBrief` accepts + persists it |
| `src/components/PositioningPanel.tsx` | pass mode at both call sites (`handlePositionLive` → `"live"`, `handleShowBrief` → `"manual"`); render `<BriefFeedback>` under `BriefView` |
| `src/components/BriefFeedback.tsx` | **new** — thumbs up/down, note field on thumbs-down, shows the persisted rating on revisit (item 4) |
| `src/components/ApplyButton.tsx` | after `setStatus(...,"applied")` succeeds, if `loadBrief(roleId)` exists → show the dismissible prompt. It already calls `loadBrief` for `had_brief`, so reuse that value rather than loading twice |
| `src/components/ReferralApplyButton.tsx` | same prompt on the warm path — it fires the same `applied` event with the same `had_brief`, so leaving it out would silently under-count the warm path |
| `src/app/admin/quality/page.tsx` | **new** — admin-gated, reads `brief_feedback` directly (the `is_admin()` select policy) |

**Source of truth is the DB, not localStorage.** Item 4 reads back through
`get_brief_feedback` rather than mirroring the rating locally — `/admin/quality`
reads the same rows, and a mirror would drift from what the admin sees.

## Instrumentation

- `brief_rated { role_id, mode, rating }` — **new**
- `brief_used_reported { role_id, used }` — **new**
- `applied { role_id, had_brief }` — **already shipped**, no change

**The `note` text never reaches `events`.** It is free text a user typed; the
project rule is that `events` carries no PII. It lives only in `brief_feedback`,
readable only by an admin.

> `track()` no-ops server-side (Stage 12 lesson → `trackServer`). All three events
> fire from client components, so plain `track()` is correct here.

## UI notes (Warm Clay)

Unobtrusive: a muted row under the brief — "Was this useful?" + two icon buttons,
44px targets. Thumbs-down reveals a single-line input, not a modal. Selected state
uses `success-soft` / `danger-soft`; no new colours. One terracotta primary per
view is already spent on "Position me", so feedback controls stay tertiary.

## States (all four, per the quality bar)

| State | Behaviour |
|-------|-----------|
| Loading | thumbs disabled while the RPC is in flight |
| Empty | no rating yet → neutral outline buttons |
| Error | RPC fails → inline muted "Couldn't save that." + the click is retryable; **never blocks the brief** |
| Success | rating persists, shows on revisit, toast-free (inline check) |

## Testing

**Pure JS (tsx, no network):** enum validation, note length cap, `'unknown'`
mode resolution for a pre-Stage-13 `StoredBrief`, and a guard that
`loadBrief` still returns a version-1 brief after the `mode` field is added
(the regression that would wipe user data).

**Live, three-leg (the `PAST_MISTAKES.md` rule):**

| # | Leg | Expected |
|---|-----|----------|
| a | **control** — `roles?select=id&limit=1` with anon key | rows → the key works |
| b | **attack** — `brief_feedback?select=*` with anon key | `[]` → invisible to the client |
| c | **attack** — direct `POST /rest/v1/brief_feedback` | denied by RLS |
| d | **app path** — `rpc/rate_brief` with a real uid | the row comes back |
| e | **attack** — `rpc/get_brief_feedback` with someone else's uid | only that uid's row; no way to enumerate |

Leg (a) is what makes (b) mean anything.

## Rollback

`drop table public.brief_feedback cascade;` + drop the three functions. Nothing
else depends on it: the feature is additive, the brief renders without it, and
`StoredBrief.mode` is optional so briefs saved during the stage stay readable.
