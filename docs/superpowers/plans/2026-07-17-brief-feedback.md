# Stage 13 — Brief Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture whether a positioning brief was any good (thumbs up/down + why) and whether it was actually used in an application, then surface it on an admin-only quality view.

**Architecture:** A `brief_feedback` table keyed by the anonymous `compass_uid`, with RLS **deny-all** and all uid access through `SECURITY DEFINER` RPCs that require the caller to present their uid (the Stage 11 `applications` pattern). One `select` policy for `is_admin()` lets `/admin/quality` read. The client gets a thin `src/lib/briefFeedback.ts` wrapper, an inline `BriefFeedback` control under the rendered brief, and a dismissible prompt on both apply buttons.

**Tech Stack:** Next.js App Router (client components), TypeScript, Tailwind v4 (Warm Clay tokens in `globals.css` `@theme`), Supabase JS (anon key only), `tsx` for standalone tests, lucide-react icons.

## Global Constraints

- **No AI spend in this stage.** Nothing calls Anthropic. Pure JS + Supabase only.
- **Anon key only. NEVER service-role.** Isolation comes from `SECURITY DEFINER` + RLS, never a privileged key.
- **`events` carries NO PII** (`src/lib/analytics.ts:11-13`): ids, enums, booleans, counts only. **The `note` text must never reach `events`.**
- **`track()` is fire-and-forget, returns void, never awaited, never throws.**
- **Never hardcode hex.** Use Warm Clay Tailwind tokens only.
- **Tailwind v4 cannot generate classes from interpolated strings** (`PAST_MISTAKES.md`, 2026-06-28). Map variants to complete static class strings.
- **44px minimum touch targets.** Handle all four states: loading / empty / error / success.
- `Result<T> = { ok: true; data: T } | { ok: false; error: string }` — the existing shape in `src/lib/referrals.ts:37`.
- **A migration and its deploy are ONE atomic change** (`PAST_MISTAKES.md`, 2026-07-15). Dev and prod share one Supabase project. The stage is not done until both are live and verified against the **production URL**.

---

### Task 1: Root fixes (referral `source`, booby-trapped comment)

Independent of everything else. Ship first so the trap is closed regardless of what happens to the rest.

**Files:**
- Modify: `src/lib/referrals.ts` (in `adminCreateReferralRole`)
- Modify: `scripts/stage8-job-ingestion.sql:14`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

**Context:** `adminCreateReferralRole` never sets `source`, and the column has no default, so new referral roles get `source = NULL`. Stage 8 backfilled `source='seed'` for pre-existing nulls, which is why the one live referral role is currently tagged `seed` — and why the documented cleanup would delete it.

- [ ] **Step 1: Read the current insert**

Run: `grep -n "adminCreateReferralRole" -A 30 src/lib/referrals.ts`

Find the object passed to `.insert(...)`. It sets `company, title, archetype, real_pm_score, real_pm_signals, crowd_response_days, location, jd_text, referrer_email, is_referral` and similar. It does **not** set `source`.

- [ ] **Step 2: Add `source: "referral"` to that insert object**

Add the field alongside `is_referral: true`, with this comment:

```ts
      // Explicit, not defaulted: `source` has no DB default, so omitting it wrote
      // NULL — and Stage 8's `update roles set source='seed' where source is null`
      // then swept referral roles into the seed bucket, where the documented
      // cleanup (`delete from roles where source='seed'`) would have deleted them.
      source: "referral",
```

- [ ] **Step 3: Fix the booby-trapped comment**

In `scripts/stage8-job-ingestion.sql`, replace line 14:

```sql
-- deletable later with:  delete from public.roles where source = 'seed';
```

with:

```sql
-- Retiring these later: DO NOT `delete from public.roles where source = 'seed'`.
-- That predicate also matches the Stage 7 REFERRAL role (created before this
-- backfill, so it was swept into 'seed') and would silently delete the warm path.
-- Prefer a soft retire, which is the pattern the ingest pipeline already uses
-- ("the bot never deletes" — scripts/stage12-cron-ingestion.sql):
--   update public.roles set is_live = false
--    where source = 'seed' and is_live = true and is_referral is not true;
-- See docs/superpowers/specs/2026-07-17-retire-seed-roles-design.md.
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add src/lib/referrals.ts scripts/stage8-job-ingestion.sql
git commit -m "fix(referrals): tag referral roles source='referral'; defuse the seed-delete comment

adminCreateReferralRole never set source and the column has no default, so
new referral roles landed as NULL — and Stage 8's backfill swept the existing
one into 'seed', where the documented cleanup would have deleted it."
```

---

### Task 2: Migration — `brief_feedback` + uid-scoped RPCs

**Files:**
- Create: `scripts/stage13-brief-feedback.sql`

**Interfaces:**
- Consumes: `public.is_admin()` (from `scripts/stage7-auth-referrals.sql`).
- Produces (later tasks call these via `supabase.rpc`):
  - `rate_brief(p_uid text, p_role text, p_mode text, p_rating text, p_note text) returns brief_feedback`
  - `report_brief_used(p_uid text, p_role text, p_mode text, p_used boolean) returns brief_feedback`
  - `get_brief_feedback(p_uid text, p_role text) returns setof brief_feedback`

**Why deny-all + definer, not a uid policy:** `compass_uid` is a localStorage value the client asserts, and the anon key is public (it ships in the browser bundle). A policy comparing a column to a client-supplied uid is satisfied by claiming someone else's uid. `stage11-ai-quota-and-rls.sql:125-135` already settled this for `applications`.

- [ ] **Step 1: Write the migration file**

Create `scripts/stage13-brief-feedback.sql`:

```sql
-- Product Compass — Stage 13: brief feedback.
-- Run ONCE in the Supabase SQL editor (service role → bypasses RLS). Idempotent.
--
-- SECURITY: anon key only, NEVER service-role. `brief_feedback` is keyed by the
-- anonymous compass_uid, which is a SECRET the client holds — not a verified
-- claim. So RLS is DENY-ALL for anon (no policies) and every uid-scoped read or
-- write goes through a SECURITY DEFINER function that REQUIRES the caller to
-- present the exact uid. No function lists uids, so enumeration is impossible.
-- This mirrors `applications` (scripts/stage11-ai-quota-and-rls.sql:125-135).
-- A uid POLICY would be worthless here: the anon key is public, so anyone could
-- POST with someone else's uid and satisfy it.

create table if not exists public.brief_feedback (
  id                  uuid primary key default gen_random_uuid(),
  uid                 text not null,                  -- compass_uid (secret)
  role_id             text not null,                  -- = roles.id (no FK; mirrors applications.role_id)
  brief_mode          text not null check (brief_mode in ('live','manual','unknown')),
  -- NULLABLE on purpose: the apply prompt ("did you use it?") can fire for a
  -- user who never rated, so a row may carry only used_in_application.
  rating              text check (rating in ('thumbs_up','thumbs_down')),
  used_in_application boolean,                        -- null = never asked / dismissed
  note                text check (note is null or length(note) <= 280),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (uid, role_id)                               -- one feedback per brief; upsert target
);

create index if not exists brief_feedback_created_idx on public.brief_feedback (created_at desc);

alter table public.brief_feedback enable row level security;

-- Deny-all for anon: NO policy is created for it. Admins may read (the
-- /admin/quality view) — same shape as sync_runs in stage 12.
drop policy if exists "brief_feedback read admin" on public.brief_feedback;
create policy "brief_feedback read admin" on public.brief_feedback
  for select to authenticated using (public.is_admin());

-- ============================================================================
-- RPCs. Each REQUIRES p_uid and filters by it. None returns a list of uids.
-- ============================================================================

create or replace function public.rate_brief(
  p_uid text, p_role text, p_mode text, p_rating text, p_note text
)
returns public.brief_feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.brief_feedback;
  v_note text;
begin
  if p_uid is null or length(trim(p_uid)) = 0 then raise exception 'uid required'; end if;
  if p_role is null or length(trim(p_role)) = 0 then raise exception 'role required'; end if;
  if p_mode is null or p_mode not in ('live','manual','unknown') then raise exception 'invalid mode'; end if;
  if p_rating is null or p_rating not in ('thumbs_up','thumbs_down') then raise exception 'invalid rating'; end if;

  -- A note only means anything on a thumbs-down; drop it otherwise so a stale
  -- complaint can't survive the user changing their mind to thumbs-up.
  v_note := case when p_rating = 'thumbs_down'
                 then nullif(trim(coalesce(p_note, '')), '')
                 else null end;
  if v_note is not null and length(v_note) > 280 then
    v_note := left(v_note, 280);
  end if;

  insert into public.brief_feedback (uid, role_id, brief_mode, rating, note)
       values (p_uid, p_role, p_mode, p_rating, v_note)
  on conflict (uid, role_id) do update
     set brief_mode = excluded.brief_mode,
         rating     = excluded.rating,
         note       = excluded.note,
         updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.report_brief_used(
  p_uid text, p_role text, p_mode text, p_used boolean
)
returns public.brief_feedback
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.brief_feedback;
begin
  if p_uid is null or length(trim(p_uid)) = 0 then raise exception 'uid required'; end if;
  if p_role is null or length(trim(p_role)) = 0 then raise exception 'role required'; end if;
  if p_mode is null or p_mode not in ('live','manual','unknown') then raise exception 'invalid mode'; end if;
  if p_used is null then raise exception 'used required'; end if;

  -- p_mode is only used on INSERT (this fires for users who never rated, and
  -- brief_mode is NOT NULL). On conflict we must NOT clobber a known mode with
  -- 'unknown', nor touch the rating.
  insert into public.brief_feedback (uid, role_id, brief_mode, used_in_application)
       values (p_uid, p_role, p_mode, p_used)
  on conflict (uid, role_id) do update
     set used_in_application = excluded.used_in_application,
         updated_at          = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.get_brief_feedback(p_uid text, p_role text)
returns setof public.brief_feedback
language sql
stable
security definer
set search_path = public
as $$
  select * from public.brief_feedback
   where uid = p_uid and role_id = p_role;
$$;

grant execute on function public.rate_brief(text, text, text, text, text)   to anon, authenticated;
grant execute on function public.report_brief_used(text, text, text, boolean) to anon, authenticated;
grant execute on function public.get_brief_feedback(text, text)             to anon, authenticated;

-- Done. // TODO(v2): retention/aggregation for old brief_feedback rows.
```

- [ ] **Step 2: User runs it in the Supabase SQL editor**

This is a human step — the agent cannot run it. Paste the file into the SQL editor and run. Expected: `Success. No rows returned.`

- [ ] **Step 3: Prove the isolation — three legs (the `PAST_MISTAKES.md` rule)**

An empty result only proves denial if you separately prove the key works. Run from a terminal (NOT the SQL editor — service-role bypasses the very thing under test):

```bash
URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2 | tr -d '\r')
KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2 | tr -d '\r')

# a. CONTROL — the key works at all
curl.exe -s "$URL/rest/v1/roles?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# b. ATTACK — the table is invisible
curl.exe -s "$URL/rest/v1/brief_feedback?select=*" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
# c. ATTACK — direct insert is denied
curl.exe -s -X POST "$URL/rest/v1/brief_feedback" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"uid":"attacker","role_id":"x","brief_mode":"live","rating":"thumbs_up"}'
# d. APP PATH — the RPC works with a uid
curl.exe -s -X POST "$URL/rest/v1/rpc/rate_brief" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_uid":"test-uid-1","p_role":"test-role-1","p_mode":"live","p_rating":"thumbs_up","p_note":null}'
```

Expected: (a) one row → the key works. (b) `[]` → invisible. (c) RLS violation (`42501`). (d) the created row returns.

- [ ] **Step 4: Clean up the probe row**

In the SQL editor: `delete from public.brief_feedback where uid = 'test-uid-1';`

- [ ] **Step 5: Commit**

```bash
git add scripts/stage13-brief-feedback.sql
git commit -m "feat(stage13): migration — brief_feedback, deny-all RLS + uid-scoped definer RPCs"
```

---

### Task 3: `StoredBrief.mode` — without wiping every saved brief

**Files:**
- Modify: `src/lib/positioning.ts` (`StoredBrief`, `saveBrief`)
- Modify: `src/components/PositioningPanel.tsx:112-114` and `:142-143` (the two `saveBrief` call sites)
- Test: `scripts/tests/storedBrief.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `StoredBrief.mode?: "live" | "manual"`; `saveBrief(roleId, brief, fit, rawJson, mode?)`.

**The trap:** `loadBrief` guards with `if (b?.version !== 1) return null`. Bumping `version` to 2 would make every already-saved brief unreadable — silent data loss on every user's device. The field goes on **at version 1**, optional.

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/storedBrief.test.ts`:

```ts
// Stage 13 — StoredBrief.mode must be additive: a brief saved BEFORE this stage
// (version 1, no mode) must still load. loadBrief guards `version !== 1`, so a
// version bump would silently wipe every saved brief on every device.
import assert from "node:assert/strict";
import { saveBrief, loadBrief, type Brief, type FitRead } from "@/lib/positioning";

// Minimal localStorage shim — positioning.ts guards on `typeof window`.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const brief: Brief = { lead_story: "s", reangled_metrics: ["m"], background: ["b"], pitch_60s: "p" };
const fit: FitRead = { matchPct: 60, covered: ["Strategy & roadmap"], framable: [], archetypeAligned: true };

// 1. A pre-Stage-13 brief (version 1, NO mode) must still load.
store.set(
  "compass_brief:legacy",
  JSON.stringify({ version: 1, roleId: "legacy", brief, fit, rawJson: "{}", savedAt: "2026-07-01T00:00:00.000Z" })
);
const legacy = loadBrief("legacy");
assert.ok(legacy, "a version-1 brief saved before mode existed must still load");
assert.equal(legacy!.mode, undefined, "legacy brief has no mode");

// 2. A new brief persists its mode and round-trips.
saveBrief("r-live", brief, fit, "{}", "live");
assert.equal(loadBrief("r-live")!.mode, "live");
saveBrief("r-manual", brief, fit, "{}", "manual");
assert.equal(loadBrief("r-manual")!.mode, "manual");

// 3. Version stays 1 — the guard must keep passing.
assert.equal(loadBrief("r-live")!.version, 1, "version must NOT be bumped");

console.log("storedBrief: all assertions passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/tests/storedBrief.test.ts`
Expected: FAIL — TypeScript error on the 5th `saveBrief` argument, or `mode` undefined for `r-live`.

- [ ] **Step 3: Implement**

In `src/lib/positioning.ts`, change the `StoredBrief` type:

```ts
export type StoredBrief = {
  version: 1;
  roleId: string;
  brief: Brief;
  fit: FitRead;
  rawJson: string; // what the user pasted, so they can re-open/edit
  savedAt: string; // ISO
  // Stage 13. OPTIONAL and the version stays 1 ON PURPOSE: loadBrief guards on
  // `version !== 1`, so bumping it would make every already-saved brief
  // unreadable — silent data loss on every device. Briefs saved before Stage 13
  // have no mode and report 'unknown' to brief_feedback.
  mode?: "live" | "manual";
};
```

and `saveBrief`:

```ts
export function saveBrief(
  roleId: string,
  brief: Brief,
  fit: FitRead,
  rawJson: string,
  mode?: "live" | "manual"
): StoredBrief {
  const stored: StoredBrief = {
    version: 1,
    roleId,
    brief,
    fit,
    rawJson,
    savedAt: new Date().toISOString(),
    mode,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(briefKey(roleId), JSON.stringify(stored));
  }
  return stored;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/tests/storedBrief.test.ts`
Expected: `storedBrief: all assertions passed`

- [ ] **Step 5: Pass the mode at both call sites**

`src/components/PositioningPanel.tsx:114` — in `handlePositionLive`:

```ts
      const s = saveBrief(role.id, data.brief, fit, raw, "live");
```

`src/components/PositioningPanel.tsx:143` — in `handleShowBrief`:

```ts
    const s = saveBrief(role.id, result.brief, fit, paste, "manual");
```

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && for f in scripts/tests/*.test.ts; do npx tsx "$f" | tail -1; done`
Expected: no tsc output; every suite prints "all assertions passed".

- [ ] **Step 7: Commit**

```bash
git add src/lib/positioning.ts src/components/PositioningPanel.tsx scripts/tests/storedBrief.test.ts
git commit -m "feat(stage13): StoredBrief.mode (optional, version stays 1)

loadBrief guards `version !== 1`, so bumping the version to add this field
would have silently wiped every saved brief on every device."
```

---

### Task 4: `src/lib/briefFeedback.ts` + event names

**Files:**
- Create: `src/lib/briefFeedback.ts`
- Modify: `src/lib/analytics.ts` (the `EventName` union)
- Test: `scripts/tests/briefFeedback.test.ts`

**Interfaces:**
- Consumes: `supabase` (`@/lib/supabase`), `Result<T>`, the Task 2 RPCs, `StoredBrief.mode` (Task 3).
- Produces:
  - `type BriefMode = "live" | "manual" | "unknown"`
  - `type BriefRating = "thumbs_up" | "thumbs_down"`
  - `type BriefFeedbackRow = { id, uid, role_id, brief_mode, rating, used_in_application, note, created_at, updated_at }`
  - `resolveBriefMode(mode: "live" | "manual" | undefined): BriefMode`
  - `validateNote(note: string | null): { ok: true; note: string | null } | { ok: false; error: string }`
  - `rateBrief(uid, roleId, mode, rating, note): Promise<Result<BriefFeedbackRow>>`
  - `reportBriefUsed(uid, roleId, mode, used): Promise<Result<BriefFeedbackRow>>`
  - `getBriefFeedback(uid, roleId): Promise<Result<BriefFeedbackRow | null>>`

- [ ] **Step 1: Write the failing test**

Create `scripts/tests/briefFeedback.test.ts` (pure functions only — no network):

```ts
// Stage 13 — pure validation for brief feedback. No network, no AI.
import assert from "node:assert/strict";
import { resolveBriefMode, validateNote, NOTE_MAX } from "@/lib/briefFeedback";

// A brief saved before Stage 13 has no mode — it must report 'unknown', never a guess.
assert.equal(resolveBriefMode(undefined), "unknown");
assert.equal(resolveBriefMode("live"), "live");
assert.equal(resolveBriefMode("manual"), "manual");

// Notes: trimmed, empty becomes null, over-long is rejected at the boundary.
assert.deepEqual(validateNote(null), { ok: true, note: null });
assert.deepEqual(validateNote("   "), { ok: true, note: null });
assert.deepEqual(validateNote("  too generic  "), { ok: true, note: "too generic" });

const long = validateNote("x".repeat(NOTE_MAX + 1));
assert.equal(long.ok, false, "a note over the cap must be rejected, not silently truncated client-side");

assert.equal(validateNote("x".repeat(NOTE_MAX)).ok, true, "exactly at the cap is fine");

console.log("briefFeedback: all assertions passed");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/tests/briefFeedback.test.ts`
Expected: FAIL — `Cannot find module '@/lib/briefFeedback'`.

- [ ] **Step 3: Implement `src/lib/briefFeedback.ts`**

```ts
// Stage 13 — data access for brief feedback (did the positioning help?).
// The uid (compass_uid) is a SECRET the client holds, not a verified claim, so
// `brief_feedback` is RLS deny-all and every call here goes through a SECURITY
// DEFINER RPC that requires the uid (scripts/stage13-brief-feedback.sql).
// A uid POLICY would be worthless: the anon key is public, so anyone could
// claim someone else's uid. Same pattern as applications (stage 11).
// NO AI. Anon key only.

import { supabase } from "@/lib/supabase";
import type { Result } from "@/lib/referrals";

export const NOTE_MAX = 280;

export type BriefMode = "live" | "manual" | "unknown";
export type BriefRating = "thumbs_up" | "thumbs_down";

export type BriefFeedbackRow = {
  id: string;
  uid: string;
  role_id: string;
  brief_mode: BriefMode;
  rating: BriefRating | null;
  used_in_application: boolean | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

// Briefs saved before Stage 13 carry no mode. Report that honestly rather than
// guessing "live" — a wrong mode would silently corrupt the live-vs-manual
// comparison that is the entire point of /admin/quality.
export function resolveBriefMode(mode: "live" | "manual" | undefined): BriefMode {
  return mode ?? "unknown";
}

export function validateNote(
  note: string | null
): { ok: true; note: string | null } | { ok: false; error: string } {
  if (note === null) return { ok: true, note: null };
  const t = note.trim();
  if (t.length === 0) return { ok: true, note: null };
  if (t.length > NOTE_MAX) return { ok: false, error: `Keep it under ${NOTE_MAX} characters.` };
  return { ok: true, note: t };
}

export async function rateBrief(
  uid: string,
  roleId: string,
  mode: BriefMode,
  rating: BriefRating,
  note: string | null
): Promise<Result<BriefFeedbackRow>> {
  const v = validateNote(note);
  if (!v.ok) return { ok: false, error: v.error };
  const { data, error } = await supabase.rpc("rate_brief", {
    p_uid: uid,
    p_role: roleId,
    p_mode: mode,
    p_rating: rating,
    p_note: v.note,
  });
  if (error) return { ok: false, error: "Couldn't save that." };
  return { ok: true, data: data as BriefFeedbackRow };
}

export async function reportBriefUsed(
  uid: string,
  roleId: string,
  mode: BriefMode,
  used: boolean
): Promise<Result<BriefFeedbackRow>> {
  const { data, error } = await supabase.rpc("report_brief_used", {
    p_uid: uid,
    p_role: roleId,
    p_mode: mode,
    p_used: used,
  });
  if (error) return { ok: false, error: "Couldn't save that." };
  return { ok: true, data: data as BriefFeedbackRow };
}

export async function getBriefFeedback(
  uid: string,
  roleId: string
): Promise<Result<BriefFeedbackRow | null>> {
  const { data, error } = await supabase.rpc("get_brief_feedback", {
    p_uid: uid,
    p_role: roleId,
  });
  if (error) return { ok: false, error: "Couldn't load feedback." };
  const rows = (data ?? []) as BriefFeedbackRow[];
  return { ok: true, data: rows[0] ?? null };
}
```

- [ ] **Step 4: Add the two event names**

In `src/lib/analytics.ts`, extend the `EventName` union (keep the existing comment style):

```ts
  | "brief_rated" // { role_id, mode, rating }
  | "brief_used_reported" // { role_id, used }
```

Add them after `"brief_copied"`. **Do not add the note text to any event** — `analytics.ts:11-13` forbids PII in props.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx tsx scripts/tests/briefFeedback.test.ts`
Expected: `briefFeedback: all assertions passed`

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/briefFeedback.ts src/lib/analytics.ts scripts/tests/briefFeedback.test.ts
git commit -m "feat(stage13): briefFeedback data access + brief_rated/brief_used_reported events"
```

---

### Task 5: `BriefFeedback` component, inline under the brief

**Files:**
- Create: `src/components/BriefFeedback.tsx`
- Modify: `src/components/PositioningPanel.tsx` (render it under `BriefView`)

**Interfaces:**
- Consumes: `rateBrief`, `getBriefFeedback`, `resolveBriefMode`, `NOTE_MAX`, `BriefRating` (Task 4); `getCompassUid` (`@/lib/compass-uid`); `track` (`@/lib/analytics`); `StoredBrief` (Task 3).
- Produces: `<BriefFeedback roleId={string} mode={"live" | "manual" | undefined} />`

**Design constraints:** unobtrusive and tertiary — the one terracotta primary on this view is already spent on "Position me". Selected state uses `success-soft` / `danger-soft`. No new colours, no hardcoded hex. 44px targets. Thumbs-down reveals a single-line input, **not** a modal. A failure here must never block the brief.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2, Check } from "lucide-react";
import { getCompassUid } from "@/lib/compass-uid";
import { track } from "@/lib/analytics";
import {
  rateBrief,
  getBriefFeedback,
  resolveBriefMode,
  NOTE_MAX,
  type BriefRating,
} from "@/lib/briefFeedback";

// Stage 13 — "was this brief any good?", inline under the rendered brief.
// Tertiary by design: the view's single terracotta primary is "Position me".
// Every failure is swallowed into a muted line — feedback must NEVER block the
// brief itself.
export function BriefFeedback({
  roleId,
  mode,
}: {
  roleId: string;
  mode: "live" | "manual" | undefined;
}) {
  const [rating, setRating] = useState<BriefRating | null>(null);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Item 4: a rated brief shows its rating on revisit. The DB is the source of
  // truth (not a localStorage mirror) because /admin/quality reads the same rows.
  useEffect(() => {
    let cancelled = false;
    const uid = getCompassUid();
    if (!uid) return;
    getBriefFeedback(uid, roleId).then((res) => {
      if (cancelled || !res.ok || !res.data) return;
      setRating(res.data.rating);
      setNote(res.data.note ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  async function submit(next: BriefRating, withNote: string | null) {
    const uid = getCompassUid();
    if (!uid) return;
    setBusy(true);
    setError(null);
    const res = await rateBrief(uid, roleId, resolveBriefMode(mode), next, withNote);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRating(next);
    setSaved(true);
    track("brief_rated", { role_id: roleId, mode: resolveBriefMode(mode), rating: next });
  }

  function onThumb(next: BriefRating) {
    setSaved(false);
    if (next === "thumbs_down") {
      setShowNote(true);
      submit(next, note.trim() || null);
      return;
    }
    setShowNote(false);
    setNote("");
    submit(next, null);
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-medium text-muted">Was this useful?</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onThumb("thumbs_up")}
            disabled={busy}
            aria-pressed={rating === "thumbs_up"}
            aria-label="This brief was useful"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-btn border transition-colors disabled:opacity-60 ${
              rating === "thumbs_up"
                ? "border-success/40 bg-success-soft text-success"
                : "border-border bg-surface text-muted hover:border-success/40 hover:text-success"
            }`}
          >
            <ThumbsUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onThumb("thumbs_down")}
            disabled={busy}
            aria-pressed={rating === "thumbs_down"}
            aria-label="This brief missed the mark"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-btn border transition-colors disabled:opacity-60 ${
              rating === "thumbs_down"
                ? "border-danger/40 bg-danger-soft text-danger"
                : "border-border bg-surface text-muted hover:border-danger/40 hover:text-danger"
            }`}
          >
            <ThumbsDown className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-hidden />}
        {saved && !busy && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Thanks
          </span>
        )}
        {error && <span className="text-xs font-medium text-danger">{error}</span>}
      </div>

      {(showNote || rating === "thumbs_down") && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => rating === "thumbs_down" && submit("thumbs_down", note.trim() || null)}
            maxLength={NOTE_MAX}
            placeholder="What was off? (optional)"
            aria-label="What was off about this brief?"
            className="min-h-[44px] w-full max-w-md rounded-btn border border-border bg-bg px-3 text-sm text-ink outline-none focus:border-primary"
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render it under the brief**

In `src/components/PositioningPanel.tsx`, import it:

```ts
import { BriefFeedback } from "@/components/BriefFeedback";
```

and change the saved-brief render (currently `{stored && <BriefView stored={stored} onReposition={handleReposition} />}`) to:

```tsx
          {stored && (
            <div>
              <BriefView stored={stored} onReposition={handleReposition} />
              <BriefFeedback roleId={role.id} mode={stored.mode} />
            </div>
          )}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: no tsc output; build completes.

- [ ] **Step 4: Commit**

```bash
git add src/components/BriefFeedback.tsx src/components/PositioningPanel.tsx
git commit -m "feat(stage13): inline thumbs up/down on the brief + persisted rating on revisit"
```

---

### Task 6: The apply prompt — **cold path only**

**Files:**
- Create: `src/components/BriefUsedPrompt.tsx`
- Modify: `src/components/ApplyButton.tsx:42-56`
- Modify: `src/components/ReferralApplyButton.tsx` — **comment only, no prompt** (see below)

**Interfaces:**
- Consumes: `reportBriefUsed`, `resolveBriefMode` (Task 4); `loadBrief` (`@/lib/positioning`); `getCompassUid`; `track`.
- Produces: `<BriefUsedPrompt roleId={string} mode={"live" | "manual" | undefined} onDone={() => void} />`

> **Why NOT the warm path — this was a design error caught while writing the plan.**
> `ReferralApplyButton.tsx:69` calls `router.push(\`/referrals/${res.data.id}\`)`
> the moment the application succeeds. **It navigates away**, so a prompt rendered
> in that component would unmount before anyone saw it. Prompting there needs the
> question to live on `/referrals/[id]` instead — a different design, and one worth
> ~nothing today: there is exactly **1** live referral role. Cold path only this
> stage; the gap is recorded, not silently skipped.
>
> **`had_brief` already ships on BOTH paths** (`ApplyButton.tsx:53`,
> `ReferralApplyButton.tsx:68`) — do not add it again.

- [ ] **Step 1: Create the prompt**

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { getCompassUid } from "@/lib/compass-uid";
import { track } from "@/lib/analytics";
import { reportBriefUsed, resolveBriefMode } from "@/lib/briefFeedback";

// Stage 13 — one question, once, after Mark as Applied. Dismissible: dismissing
// leaves used_in_application NULL, which is why that column is nullable. Never
// blocks the apply — the application is already saved by the time this renders.
export function BriefUsedPrompt({
  roleId,
  mode,
  onDone,
}: {
  roleId: string;
  mode: "live" | "manual" | undefined;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function answer(used: boolean) {
    const uid = getCompassUid();
    if (!uid) return onDone();
    setBusy(true);
    await reportBriefUsed(uid, roleId, resolveBriefMode(mode), used);
    track("brief_used_reported", { role_id: roleId, used });
    setBusy(false);
    onDone();
  }

  return (
    <div className="mt-3 rounded-card border border-border bg-surface-alt px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink">
          Did you use the positioning brief in this application?
        </p>
        <button
          type="button"
          onClick={onDone}
          aria-label="Dismiss"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => answer(true)}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-btn border border-border bg-surface px-4 text-sm font-semibold text-ink hover:border-success/40 hover:text-success disabled:opacity-60"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => answer(false)}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-btn border border-border bg-surface px-4 text-sm font-semibold text-ink hover:border-border disabled:opacity-60"
        >
          No
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `ApplyButton.tsx`**

Add imports:

```ts
import { BriefUsedPrompt } from "@/components/BriefUsedPrompt";
import type { StoredBrief } from "@/lib/positioning";
```

Add state next to the others:

```ts
  const [askUsed, setAskUsed] = useState<StoredBrief | null>(null);
```

Replace `markApplied`'s success branch (`:50-54`) so it reuses the single `loadBrief` call rather than loading twice:

```ts
    } else {
      setStatusState(res.application.status);
      const savedBrief = loadBrief(roleId);
      // had_brief powers "% of applications sent with a brief" (docs/METRICS.md).
      track("applied", { role_id: roleId, had_brief: savedBrief !== null });
      // Stage 13: had_brief says a brief EXISTED; this asks whether it was USED.
      if (savedBrief) setAskUsed(savedBrief);
    }
```

In the applied-confirmation branch (`:64-80`), render the prompt under the existing card by wrapping the returned element:

```tsx
  if (status) {
    return (
      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-success/30 bg-success-soft/50 px-4 py-3">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            Tracking · {statusLabel(status)}
          </p>
          <Link
            href="/tracking"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-colors hover:text-primary-hover"
          >
            View in Tracking
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {askUsed && (
          <BriefUsedPrompt roleId={roleId} mode={askUsed.mode} onDone={() => setAskUsed(null)} />
        )}
      </div>
    );
  }
```

Note the outer `mt-4` moved to the wrapper and was removed from the inner card.

- [ ] **Step 3: Record the warm-path gap in `ReferralApplyButton.tsx`**

Do **not** add a prompt here. Add this comment directly above the
`router.push(...)` at line 69 so the next reader doesn't "fix" the omission:

```ts
    // Stage 13: no "did you use the brief?" prompt on this path — we redirect to
    // the thread immediately, so a prompt would unmount before it was seen. To
    // cover the warm path the question has to live on /referrals/[id].
    // // TODO(v2): prompt on the thread page once referral volume justifies it.
```

- [ ] **Step 3b: Note the limitation where it will be misread**

In `src/app/admin/quality/page.tsx` (Task 7) the usage-rate copy must say the rate
is **cold-path only**. Task 7's code already carries a caveat line; extend it to:

```tsx
            <p className="mt-1 text-xs text-muted">
              Cold path only — the referral flow redirects on apply, so it is never
              asked. Dismissed prompts are excluded (used_in_application is null), so
              this is a rate among people who answered, not among everyone who applied.
            </p>
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: no tsc output; build completes.

- [ ] **Step 5: Commit**

```bash
git add src/components/BriefUsedPrompt.tsx src/components/ApplyButton.tsx src/components/ReferralApplyButton.tsx
git commit -m "feat(stage13): ask whether the brief was used, on both apply paths"
```

---

### Task 7: `/admin/quality`

**Files:**
- Create: `src/app/admin/quality/page.tsx`
- Modify: `src/app/admin/page.tsx` (add a link to it)

**Interfaces:**
- Consumes: `useUser`, `isAdminEmail` (`@/lib/auth`); `supabase`; `AuthNav`; `BriefFeedbackRow` (Task 4).
- Produces: nothing.

**Access:** admin-gated in the UI **and** at the data layer — the `select` policy from Task 2 (`using (public.is_admin())`) is the real gate; `isAdminEmail` only drives what renders (`src/lib/auth.ts:92-97`).

- [ ] **Step 1: Create the page**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, Compass, Loader2, AlertTriangle, ThumbsUp, ThumbsDown } from "lucide-react";
import { useUser, isAdminEmail } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { AuthNav } from "@/components/AuthNav";
import type { BriefFeedbackRow } from "@/lib/briefFeedback";

// Stage 13 — admin-only brief quality. Reads brief_feedback directly: the
// "brief_feedback read admin" policy (using is_admin()) is the real gate; the
// email check below only decides what renders.
export default function QualityPage() {
  const { user, loading } = useUser();
  const admin = isAdminEmail(user?.email);
  const [rows, setRows] = useState<BriefFeedbackRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    supabase
      .from("brief_feedback")
      .select("id,uid,role_id,brief_mode,rating,used_in_application,note,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setRows((data ?? []) as BriefFeedbackRow[]);
      });
  }, [admin]);

  const byMode = (m: string) => (rows ?? []).filter((r) => r.brief_mode === m);
  const up = (rs: BriefFeedbackRow[]) => rs.filter((r) => r.rating === "thumbs_up").length;
  const down = (rs: BriefFeedbackRow[]) => rs.filter((r) => r.rating === "thumbs_down").length;
  const asked = (rows ?? []).filter((r) => r.used_in_application !== null);
  const usedYes = asked.filter((r) => r.used_in_application === true).length;
  const notes = (rows ?? []).filter((r) => r.rating === "thumbs_down" && r.note).slice(0, 20);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex items-center justify-between gap-3">
        <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Compass className="h-4 w-4" aria-hidden />
          Admin
        </Link>
        <AuthNav />
      </header>

      <h1 className="inline-flex items-center gap-2 font-heading text-3xl font-extrabold tracking-tight text-ink">
        <Shield className="h-7 w-7 text-primary" aria-hidden />
        Brief quality
      </h1>

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking access…
        </div>
      ) : !admin ? (
        <div className="mt-8 rounded-card border border-border bg-surface-alt px-6 py-10 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-accent" aria-hidden />
          <p className="mt-2 text-sm text-muted">Admins only.</p>
        </div>
      ) : rows === null ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border bg-surface-alt px-6 py-10 text-center">
          <p className="text-sm text-muted">No feedback yet.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {error && (
            <p className="inline-flex items-center gap-1.5 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {error}
            </p>
          )}

          <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)]">
            <h2 className="font-heading text-lg font-bold text-ink">Ratings by mode</h2>
            <p className="mt-1 text-sm text-muted">
              With a handful of ratings this is descriptive, not evidence — don&apos;t read a
              live-vs-manual winner out of single digits.
            </p>
            <ul className="mt-4 divide-y divide-border">
              {["live", "manual", "unknown"].map((m) => {
                const rs = byMode(m);
                return (
                  <li key={m} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="font-semibold text-ink">{m}</span>
                    <span className="inline-flex items-center gap-4 text-muted">
                      <span className="inline-flex items-center gap-1.5 text-success">
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
                        {up(rs)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-danger">
                        <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
                        {down(rs)}
                      </span>
                      <span className="text-xs">{rs.length} total</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)]">
            <h2 className="font-heading text-lg font-bold text-ink">Usage</h2>
            <p className="mt-2 text-sm text-ink">
              <span className="font-bold">{usedYes}</span> of{" "}
              <span className="font-bold">{asked.length}</span> answered &ldquo;yes, I used
              it&rdquo;
              {asked.length > 0 && (
                <span className="text-muted">
                  {" "}
                  · {Math.round((usedYes / asked.length) * 100)}%
                </span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted">
              Dismissed prompts are excluded (used_in_application is null), so this is a rate
              among people who answered — not among everyone who applied.
            </p>
          </section>

          <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)]">
            <h2 className="font-heading text-lg font-bold text-ink">Recent thumbs-down notes</h2>
            {notes.length === 0 ? (
              <p className="mt-2 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-btn border border-border bg-surface-alt px-3 py-2">
                    <p className="text-sm text-ink">{n.note}</p>
                    <p className="mt-1 text-xs text-muted">
                      {n.brief_mode} · {new Date(n.created_at).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Link it from `/admin`**

In `src/app/admin/page.tsx`, inside the admin branch (`<div className="mt-6 space-y-8">`, ~line 81), add above `<SyncJobsPanel />`:

```tsx
          <Link
            href="/admin/quality"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-hover"
          >
            Brief quality →
          </Link>
```

`Link` is already imported there.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: no tsc output; `/admin/quality` appears in the route list.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/quality/page.tsx src/app/admin/page.tsx
git commit -m "feat(stage13): admin-only /admin/quality — ratings by mode, usage rate, recent notes"
```

---

### Task 8: STOP — verification record + checklist

**Files:**
- Create: `docs/VERIFICATION_STAGE13.md`
- Modify: `knowledge/SESSION_JOURNAL.md`, `knowledge/DECISIONS.md`

- [ ] **Step 1: Run everything**

```bash
npx tsc --noEmit
for f in scripts/tests/*.test.ts; do npx tsx "$f" | tail -1; done
npx next build
```

Expected: no tsc output; every suite "all assertions passed"; build clean.

- [ ] **Step 2: Write `docs/VERIFICATION_STAGE13.md`**

Follow `docs/VERIFICATION_STAGE12.md`'s shape: a §0 setup section (run the migration), then a table per claim with an **Actual** column left as `⬜ not yet run`.

> **Fill the Actual column ONLY from output that exists — pasted by the user or
> returned by a tool call.** Writing a verdict you instructed but didn't observe
> is the 2026-07-16 mistake in `PAST_MISTAKES.md`.

Claims to record:
- a. Migration ran; three-leg isolation proof (control / attack / app-path / cross-uid).
- b. Thumbs up then reload → rating persists (item 4).
- c. Thumbs down → note saves; switching to thumbs-up clears the note.
- d. Mark as Applied on a role with a brief → prompt appears; Yes/No stores; dismiss leaves null.
- e. Mark as Applied on a role with **no** brief → **no** prompt.
- f. `/admin/quality` as admin → counts by mode, usage rate, notes. As non-admin → "Admins only".
- g. `select name, props from events where name in ('brief_rated','brief_used_reported')` → **no note text, no PII**.
- h. A brief saved **before** this stage still opens and reports mode `unknown`.

- [ ] **Step 3: Record the lessons**

`SESSION_JOURNAL.md` (newest at top) + a `DECISIONS.md` line each for: the deny-all + definer choice over a uid policy; nullable `rating`; `'unknown'` mode with the version-1 guard.

- [ ] **Step 4: Commit and STOP**

```bash
git add docs/VERIFICATION_STAGE13.md knowledge/
git commit -m "docs(stage13): verification record + journal/decisions"
```

**Then STOP.** Print the checklist and ask the user to verify before Stage 14. Do not start Stage 14.

---

## Deferred to the user (cannot be automated)

1. Run `scripts/stage13-brief-feedback.sql` in the Supabase SQL editor.
2. Confirm the three-leg proof from a terminal (Task 2, Step 3).
3. Walk the flow on the deployed app and confirm b–h above.
