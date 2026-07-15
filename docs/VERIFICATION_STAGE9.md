# Stage 9 — Verification: three-persona referral flow

> **Purpose.** Prove, by clicking, that the referral collaboration built in Stage 7
> works end-to-end AND that its privacy guarantee holds: **an admin can see that a
> thread exists (and its message count) but can NEVER read the messages.** The RLS
> half of that proof is automated in [`rls_proof.sql`](./rls_proof.sql); this script
> is the human, in-browser half.
>
> This is a **test script only** — no new features. If a step's *Expected* does not
> match reality, stop and record it under **Bugs found** at the bottom.

---

## 0. Personas & accounts

You need **three distinct signed-in identities**. Use `+alias` addressing so every
one-time code lands in the same real inbox (`shwetaswain13november@gmail.com`), but
keep the addresses distinct so RLS treats them as three different people.

| Persona   | Email to use                                    | Must be admin? |
|-----------|-------------------------------------------------|----------------|
| **Admin** | `shwetaswain13november@gmail.com`               | **Yes** — in `ADMIN_EMAILS` (`src/config.ts`) **and** `is_admin()` (SQL) |
| **Referrer** | `shwetaswain13november+referrer@gmail.com`   | No |
| **Referee**  | `shwetaswain13november+referee@gmail.com`    | No |

> ⚠️ Keep **admin ≠ referrer ≠ referee**. If the admin is also the referrer or
> referee, the "admin can't read the thread" proof is meaningless (they'd have
> access as a participant, not as admin).

**Run each persona in its own browser or incognito window** so three sessions
coexist. Sign in via the **typed OTP code**, not the magic link (link is flaky with
Gmail — see `DECISIONS.md`). The app accepts a 6–10 digit code.

**Pre-req (one-time):** `scripts/stage7-auth-referrals.sql` has been run in Supabase.

**Where to run:** local (`npm run dev` → `http://localhost:3000`) or the live
lilac URL. Note which one on each run.

---

## a. Admin posts a referral role and tags the referrer

| # | Action | Expected |
|---|--------|----------|
| a1 | **Admin** window → sign in → go to `/admin` | Page shows **Sync jobs**, **Post a referral job**, **Referral applications** sections (not the "Not authorized" gate). |
| a2 | In **Post a referral job**: Company = `Acme`, Title = `Senior PM, Payments`, Archetype = any, Real-PM score = `78`, Location = `Remote`, **Referrer email = `shwetaswain13november+referrer@gmail.com`**, a short JD. Click **Post referral role**. | Green confirmation: *"Posted — it's live in the roles list."* Form clears. |
| a3 | Go to `/roles`, find **Senior PM, Payments · Acme** | Card carries a **"Referral available"** badge. |

> Record the role title so you can find it as the referee.

---

## b. Referee applies → shared application + private thread created

| # | Action | Expected |
|---|--------|----------|
| b1 | **Referee** window → `/roles` → open **Senior PM, Payments · Acme** | Role detail shows a **"Referral available"** panel (via `+referrer`), not the anonymous "Mark as Applied" button. |
| b2 | (If signed out) Click **Sign in to apply** → complete OTP → you return to the role | Signed in; panel now shows **Apply via referral** button. |
| b3 | Click **Apply via referral** | Redirects to `/referrals/<id>`. Shows role header, **Status · Applied** strip, and a **Private thread** with the warm empty-thread prompt ("This is your private line with your referrer…"). |
| b4 | Note the status strip as the referee | Only **Closed** is clickable; **Seen / Shared with HM / Shortlisted** are not settable. Hint reads *"The referrer updates progress here. You can mark Closed if you withdraw…"* |
| b5 | Go to `/referrals` | The application is listed, labelled **"You applied · Applied"**, **no** unread dot (you just opened it). |

---

## c. Referrer comments → referee sees unread dot → referee replies

| # | Action | Expected |
|---|--------|----------|
| c1 | **Referrer** window → sign in as `+referrer` → `/referrals` | The **Senior PM, Payments** application is listed, labelled **"You're the referrer"**. (Referrer is matched by email — no invite needed.) |
| c2 | Open it → read the strip & thread | Status strip: **Seen / Shared with HM / Shortlisted / Closed** are settable; **Applied** is not. Hint: *"You drive these updates…"* Thread shows the referrer empty-prompt + composer. |
| c3 | Type a message ("Hi! Send me a short blurb I can pass along") → **Send** | Message appears right-aligned labelled **You**. |
| c4 | **Referee** window → refresh `/referrals` | The application now shows an **unread dot**; the **Referrals** nav link shows the dot too. |
| c5 | Referee opens the thread | The referrer's message is visible (left-aligned, labelled by email/"Referrer"). Opening it clears the unread dot. |
| c6 | Referee types a reply → **Send** | Reply appears right-aligned as **You**. |
| c7 | **Referrer** window → refresh `/referrals` | Unread dot now shows for the referrer. |

> After this step the thread has **≥ 2 messages** — needed for the `rls_proof.sql`
> assertions. Note the count.

---

## d. Referrer advances status: Applied → Seen → Shared w/HM → Shortlisted

| # | Action | Expected |
|---|--------|----------|
| d1 | **Referrer** thread → click **Seen** | Strip advances to Seen; header reads **Status · Seen**. No error. |
| d2 | Click **Shared with HM** | Advances; **Applied → Seen** now show as done (check ticks). |
| d3 | Click **Shortlisted** | Advances to Shortlisted. |
| d4 | **Referee** window → refresh `/referrals` then open thread | Status reflects **Shortlisted** (shared state), and the row shows an unread dot before opening (status changed after last seen). |

---

## e. Referee status permissions (must fail except Closed), then Closed

| # | Action | Expected |
|---|--------|----------|
| e1 | **Referee** thread → try to click **Seen / Shared with HM / Shortlisted** | **Nothing happens** — those chips are not clickable for the referee (disabled; hover title *"The referrer updates this stage"*). This is the UX guardrail; RLS is the real gate. |
| e2 | Referee clicks **Closed** → confirm the dialog | Status becomes **Closed**. |
| e3 | **Referrer** / **Admin** refresh | Both see status **Closed**. |

> Optional deeper proof (referee truly can't set a non-Closed status even bypassing
> the UI): in the referee's browser devtools console, the RLS UPDATE policy still
> permits the row write (referee_id = auth.uid()), so this is a **UX** restriction,
> not an RLS one. The privacy guarantee that IS enforced by RLS is the comment
> thread — proven in step f + `rls_proof.sql`.

---

## f. Admin overview: status + "Thread · N messages" but NEVER contents

| # | Action | Expected |
|---|--------|----------|
| f1 | **Admin** window → `/admin` → **Referral applications** | The Acme application row is listed: role · **referee email** · **referrer email** · a **Thread · N messages** chip · a status **override** dropdown reading **Closed**. |
| f2 | Confirm the chip count | **N equals the real message count** from step c (proves the count leaks, the contents don't). |
| f3 | Verify NO message text anywhere on `/admin` | Scan the whole page — **no comment body text is rendered anywhere**. |
| f4 | Admin opens the thread directly: `/referrals/<id>` | **Private thread** section shows the **Lock card**: *"This thread is private to the applicant and referrer and is hidden from admins — even you. You can see that N messages exist, but not their contents."* **No message bodies render.** |
| f5 | Admin changes the status dropdown to **Seen** (override), then back to **Closed** | Override works (admin can set any stage); referrer/referee see the change on refresh. |

✅ **Pass = all of a–f match.** Then run [`rls_proof.sql`](./rls_proof.sql) in the
Supabase SQL editor to prove the same privacy guarantee at the database layer
(admin `SELECT` on `comments` returns **0 rows**; referee/referrer return the real
rows). The browser proof shows the UI honors it; the SQL proof shows the UI *can't
not* honor it.

---

## Bugs found (fill in during the run)

| Step | What happened | Expected | Severity |
|------|---------------|----------|----------|
|      |               |          |          |
