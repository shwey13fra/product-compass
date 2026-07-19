# Stage 16 — Free/Pro tiers + willingness-to-pay signal

**Date:** 2026-07-19
**Status:** Approved (design)
**Constraint:** NO payment provider in this stage. "Upgrade" = record intent + manual admin flip.

## Problem
Live positioning burns AI credit (durable €5 budget). We need to (a) cap free usage
to a small, honest number, (b) offer a Pro tier that lifts the cap, and (c) measure
willingness-to-pay *before* building any billing — via an explicit "I'm interested"
signal. The free tier must stay genuinely useful so the product still works at zero spend.

## Confirmed decisions
1. **Pro requires sign-in.** `plan` lives on `profiles` (auth-only). Anonymous
   `compass_uid` users are always free-tier (3/mo keyed by uid). To become Pro a user
   signs in (so admin has a profile row) and an admin flips the plan.
2. **`FREE_BRIEFS_PER_MONTH` (default 3) replaces `AI_MONTHLY_LIMIT` (15)** as the
   monthly cap. Free = 3/mo. Pro = unlimited live briefs (still IP-hourly-capped).
   `AI_MONTHLY_LIMIT` is retired.
3. Manual paste-in stays unlimited and free (no quota, no AI credit).

## Architecture

### Data model — `scripts/stage16-plans-and-quota.sql` (idempotent)
- `profiles`: `add column plan text not null default 'free' check (plan in ('free','pro'))`.
- **`get_ai_usage(p_identity text)` returns `used int`** — current `YYYY-MM` count,
  READ-ONLY (no increment). Powers the pre-click indicator. Definer, grant anon+authenticated.
- **Modify `increment_ai_usage(p_identity, p_limit)`**: `p_limit < 0` ⇒ unlimited
  (always `allowed=true`, still increments so Pro usage is measured; `remaining` returns -1).
  `p_limit >= 0` behaviour unchanged.
- **`admin_set_plan(p_email text, p_plan text)`** — `is_admin()`-guarded; updates
  `profiles.plan` where `email = lower(p_email)`; returns rows affected. Definer, grant authenticated.

### Plan resolution (server, security-critical)
Pro is derived **only** from a VERIFIED bearer token → that user's `profiles.plan`.
NEVER from `compass_uid`/`x-compass-uid` (client-controlled — trusting them would let
anyone spoof a Pro user's UUID to steal unlimited). Anonymous ⇒ `free`.
- Limit: `pro → -1` (unlimited); `free → FREE_BRIEFS_PER_MONTH` (env, default 3).

### `GET /api/quota` (new, read-only)
Resolves verified plan + identity's `used`; returns `{ plan, limit: number|null, used, remaining }`
(`limit: null` = unlimited/Pro). No AI call, no increment — cannot be abused to drain budget.

### `POST /api/position` (changes)
Resolve plan → limit → pass to `increment_ai_usage` (`-1` for Pro). On exhaustion,
response adds `{ limitReached: true, plan }`. Success responses add `{ plan, remaining }`
to refresh the indicator. Remove `AI_MONTHLY_LIMIT` usage; read `FREE_BRIEFS_PER_MONTH`.

### UI — `PositioningPanel.tsx` + two components
- **`QuotaIndicator`** near the Position Me button; on mount GET `/api/quota`.
  - free → chip "N of 3 free briefs left this month."
  - pro → honey chip "Pro · unlimited live briefs."
- **`UpgradePanel`** (Warm Clay) when free user at 0, or a generate attempt returns
  `limitReached`. Explains Pro, reassures what stays free, and:
  - Primary **"I'm interested"** → `track("upgrade_intent")` → inline thank-you (the WTP signal).
  - If anonymous, adds "Sign in to go Pro" nudge.
  - Offers manual paste-in right there as the unlimited free alternative.
  - Fires `track("quota_exhausted")` once when shown.

### Admin — `admin/page.tsx`
New **"Plans"** panel (mirrors PostReferralForm): email + free/pro select → `admin_set_plan` → feedback.

### Events — `analytics.ts`
Add union members `quota_exhausted { plan }`, `upgrade_intent { plan }`. PII-free (enums only).

## Unchanged & free
Discovery, fit read, freshness, crowd stats, tracking, manual paste-in.

## Out of scope (v2+ seams)
Payment/checkout/Stripe, self-serve upgrade, billing/receipts/proration.

## Security seams
- Plan derived only from verified auth id (compass_uid can't grant Pro).
- `admin_set_plan` guarded by `is_admin()` in Postgres, not just UI.
- `/api/quota` never increments.
- Events PII-free.

## Budget note (accepted)
With `AI_MONTHLY_LIMIT` retired, Pro is capped only by the IP hourly backstop (10/hr).
Acceptable because Pro is admin-granted. No global ceiling for Pro.

## Verification (Stage 16 gate — STOP after)
1. Free identity: indicator shows "3 of 3" → generate 3 → indicator decrements → 4th blocked
   with UpgradePanel; `quota_exhausted` recorded.
2. "I'm interested" → `upgrade_intent` recorded; thank-you shown.
3. Admin sets a signed-in user to `pro` → that user's indicator shows "Pro · unlimited";
   4th+ live brief succeeds (IP cap still applies).
4. Manual paste-in works at 0 remaining (free, unlimited).
5. Spoof check: setting `x-compass-uid` to another user's UUID does NOT grant Pro.
Then STOP and ask for verification before Stage 17.
