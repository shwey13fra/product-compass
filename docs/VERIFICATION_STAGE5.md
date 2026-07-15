# Stage 5 — Verification: the tracking flow

> **Purpose.** Prove the anonymous, no-login tracking flow works end-to-end:
> Mark as Applied → it appears on `/tracking` → the status strip transitions and
> persists → the follow-up nudge fires at *Seen* → *Closed* surfaces similar live
> roles. All state is keyed by the anonymous `compass_uid` in `localStorage` and
> must survive reloads.
>
> This is a **test script only** — no new features. Mismatch → record under
> **Bugs found**.

---

## 0. Setup

- **No sign-in needed** — this is the anonymous track (`compass_uid`, not auth).
- **Pre-req (one-time):** `scripts/applications-table.sql` has been run in Supabase.
- Use **one ordinary browser window** (NOT incognito, so `localStorage` persists
  across reloads). Note whether you're on local (`npm run dev`) or the lilac URL.
- Do the whole run in the **same browser profile** — a different browser = a
  different `compass_uid` = a fresh, empty tracker.

> The "Demo: simulate a week passing" affordance is built into the tracking card
> (`backdateStatusChange`), so **no SQL and no waiting** is needed to see the
> time-based nudge.

---

## a. Mark as Applied

| # | Action | Expected |
|---|--------|----------|
| a1 | `/roles` → open any **non-referral** role (no "Referral available" badge). Note its title. | Role detail renders (score, JD, freshness). At the top is a **Mark as Applied** button (anonymous track), not the referral panel. |
| a2 | Click **Mark as Applied** | Button flips to a green pill: **Tracking · Applied** with a **View in Tracking →** link. |
| a3 | Reload the page | Still shows **Tracking · Applied** (persisted to Supabase via `compass_uid`). |

---

## b. Appears in /tracking

| # | Action | Expected |
|---|--------|----------|
| b1 | Click **View in Tracking →** (or go to `/tracking`) | The **Tracking** page lists a card for the role you applied to. Header = title + company + archetype, a status pill reading **Applied**, and the 5-step status strip. |
| b2 | Confirm the empty/loading states are gone | Not the "Nothing tracked yet" empty card and not the perpetual spinner — a real card. |

---

## c. Status strip transitions + persistence

| # | Action | Expected |
|---|--------|----------|
| c1 | On the card, click **Seen** | Strip advances; **Applied** shows a done tick, **Seen** is current. Pill reads **Seen**. |
| c2 | Reload `/tracking` | Card is still at **Seen** (persisted). |
| c3 | (Anonymous track allows all stages) click **Shared with HM**, then **Shortlisted** | Each advances; earlier stages show done ticks. |
| c4 | Set it back to **Seen** (click Seen again) | Returns to Seen — needed for the nudge test in (d). |

> Note: on the anonymous `/tracking` strip **every stage is clickable** (it's your
> own private tracker). The role-permissioned restriction only applies to the
> *referral* strip (Stage 9).

---

## d. Follow-up nudge via the "simulate a week" flag

The nudge only fires when the card is at **Seen** AND
`days since status_changed_at ≥ crowd_response_days` (fallback 5). Freshly set to
Seen it's 0 days, so use the demo control.

| # | Action | Expected |
|---|--------|----------|
| d1 | Card at **Seen**, no nudge showing yet | Below the strip is a dashed button: **⏩ Demo: simulate a week passing**. |
| d2 | Click **Demo: simulate a week passing** | The demo button disappears and a honey/amber nudge appears: **"Good time for a light follow-up."** followed by *"Seen 7 days ago with no movement."* |
| d3 | Reload `/tracking` | The nudge is still there (the backdated `status_changed_at` persisted). |

> If the role's `crowd_response_days` is > 7, one click may not cross the
> threshold — click **simulate a week** again (each click shifts another 7 days).
> The demo button only shows while at Seen with no active nudge.

---

## e. Closed → similar live roles panel

| # | Action | Expected |
|---|--------|----------|
| e1 | On the card, click **Closed** → confirm the browser dialog | Card status becomes **Closed**. The warm/cold path hint disappears. |
| e2 | Observe the bottom of the card | A **"Similar live roles to move on to"** section appears with up to 3–4 live roles of the **same archetype** (excludes this role), each linking to its detail. |
| e3 | If none exist | Graceful fallback text: *"No other live \<archetype\> roles right now — browse all roles."* (a link), not a broken/empty box. |
| e4 | Reload `/tracking` | Still **Closed**, still showing the similar-roles section (persisted). |

✅ **Pass = all of a–e match, and every state survived a reload.**

---

## Warm/cold path spot-check (optional, part of Stage 5)

While a tracked role is **open** (not Closed):
- A **warm-path** role (has_warm_path) shows an **"Ask for an intro"** affordance
  with a copyable, pre-drafted message (built from your saved experience, no AI).
- A **cold-path** role shows the crowd stat: *"Members typically hear back in ~X
  days. Follow up by day X or move on."*

---

## Bugs found (fill in during the run)

| Step | What happened | Expected | Severity |
|------|---------------|----------|----------|
|      |               |          |          |
