# Stage 15 — Verification: email notifications for referral collaboration

> **Purpose.** Prove the Stage 15 claims against prod (not localhost):
>
> 1. A **status change** emails the *other* party (role title + CTA, **no comment text**).
> 2. A **new comment** emails the other party **with the body**; only the two thread
>    parties ever receive it. The **admin is never** a recipient.
> 3. **Preferences** (account-menu toggle, default on) are respected before every send;
>    an **unsubscribe** link works with no login.
> 4. **Throttle:** rapid comments → at most **1 email per thread/recipient per 10 min**.
> 5. **Fire-and-forget:** an email failure never fails the status/comment write.
>
> **Run status: ⬜ NOT RUN.** Local `npm run build` passes (TypeScript + static gen; the 3
> new routes registered). Everything below needs **working sign-in + a verified Resend
> domain** first (docs/SIGNIN_UNBLOCK.md). Nothing may be marked ✅ from expectation — only
> from observed output (PAST_MISTAKES 2026-07-16 rule).

---

## 0. Setup — the user must do this first
1. **Sign-in unblock** — follow `docs/SIGNIN_UNBLOCK.md`: verify a Resend domain, set Resend
   as Supabase Auth SMTP, fix the redirect allowlist. Confirm you can receive a sign-in code.
2. **Run the migration** — paste `scripts/stage15-notifications.sql` into the Supabase SQL
   editor. Expected: `Success. No rows returned.`
3. **Set server env** (Vercel + `.env.local`): `RESEND_API_KEY`, `RESEND_FROM` (verified-domain
   address), `NEXT_PUBLIC_APP_URL=https://product-compass-lilac.vercel.app`.
4. **Deploy** (merge `stage15` → `main`). Verify against the **prod URL**.
5. **Two accounts** — you'll need two emails you control to play referee + referrer.

> **Stage 11 lesson:** migration is additive (new tables + functions), but the routes read
> `resolve_notification`, so the app deploy and the migration must both be live. Verify on prod.

---

## §0. Sign-in works (also unblocks Stage 14 §c) ⬜ NOT RUN
- Request a code on prod → it arrives within seconds (inbox, not spam) → sign in. ⬜
- **Stage 14 §c (carried):** signed **out**, apply to a role + fill experience, then sign in →
  the *"Your saved work has been linked to your account."* toast shows **once**;
  `applications`/`experience_profiles` rows re-key to the auth id; `/tracking` still lists them. ⬜

## §a. Status-change email ⬜ NOT RUN
Referrer signs in (tagged email) → opens a referral thread → moves status (e.g. → Shortlisted).
- The **referee** receives an email: subject `… · now Shortlisted`, role title, a terracotta
  **Open the thread** CTA → `/referrals/<id>`, and **no comment text**. ⬜
- Referee withdraws (→ Closed) → the **referrer** receives the status email. ⬜
- Admin overrides status from `/admin` → the **referee** is notified; the acting party never
  emails themselves. ⬜

## §b. Comment email (with body) ⬜ NOT RUN
Post a comment in the thread → the other party receives an email containing the **message body**
and a **Reply in the thread** CTA. ⬜

## §c. Recipient rules ⬜ NOT RUN
- The **admin** never receives a comment or status email (they're not a thread party). ⬜
- Inspect a received status email's HTML/text: it contains **no** comment content. ⬜

## §d. Throttle ⬜ NOT RUN
Post **3 comments within ~2 min** in one thread. The other party gets **exactly one** email.
Confirm in SQL:
```sql
select application_id, kind, recipient_email, sent_at
  from notification_log
 where kind = 'comment'
 order by sent_at desc limit 10;
```
→ EXPECT a single `comment` row for that (application, recipient) inside the 10-min window. ⬜

## §e. Preferences + unsubscribe ⬜ NOT RUN
- Account menu (▾ by your email) → toggle **Email notifications off**. Trigger an event to that
  user → **no email** sent (`select emails_enabled from notification_prefs where email='…';`
  shows `false`). ⬜
- Toggle back on → emails resume. ⬜
- Click the **Unsubscribe** link in any received email (while logged out) → confirmation page;
  `notification_prefs.emails_enabled` flips to `false`; subsequent events send nothing. ⬜

## §f. Fire-and-forget ⬜ NOT RUN
Temporarily set a **bad** `RESEND_API_KEY` on a preview deploy (or unset `RESEND_FROM`) → change
a status / post a comment. EXPECT: the write **succeeds** and the UI updates normally; the
failure is captured in `errors` (`select source,message from errors order by created_at desc
limit 5;` → an `email` / `email/send` row), never surfaced to the user. ⬜

---

## Verdict
⬜ **NOT RUN** — awaiting sign-in unblock + Resend domain + migration + prod deploy. Local build
is green. Fill each section only from observed output.
