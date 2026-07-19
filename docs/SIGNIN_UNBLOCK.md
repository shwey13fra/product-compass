# Sign-in unblock — fix email delivery (Supabase Auth → Resend SMTP)

> **Symptom.** Email sign-in on prod doesn't work — the code/link never arrives (or lands
> in spam). This blocks verifying **Stage 14 §c** (claim on sign-in) and **all of Stage 15**
> (referral notifications need two signed-in users).
>
> **Root cause (not a code bug).** `src/lib/auth.ts` + `/signin` are correct and offer TWO
> paths — a magic link **and** a redirect-independent 6-digit OTP code (`verifyEmailOtp`).
> Since even the OTP code doesn't arrive, the failure is **email delivery**: Supabase's
> built-in email service is throttled to a handful of messages per hour and is frequently
> spam-filtered. The fix is to send Supabase Auth email through **Resend** (the same provider
> Stage 15 uses for notifications — one setup serves both).

## Do this (dashboard steps — ~10 min)

### 1. Verify a sending domain in Resend
- Resend → **Domains** → Add Domain (a subdomain like `mail.yourdomain.com` is fine).
- Add the DNS records Resend shows (SPF/DKIM) at your registrar; wait for **Verified**.
- Create an API key (Resend → **API Keys**) → this is your `RESEND_API_KEY` (used here **and**
  as the Stage 15 server env var).

### 2. Point Supabase Auth at Resend SMTP
Supabase Dashboard → **Authentication → Emails → SMTP Settings** → *Enable Custom SMTP*:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your `RESEND_API_KEY` |
| Sender email | an address on the **verified** domain, e.g. `no-reply@mail.yourdomain.com` |
| Sender name | `Product Compass` |

Save. This both **fixes deliverability** and lifts the built-in rate cap.

### 3. Fix the redirect allowlist (so the magic link can land)
Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://product-compass-lilac.vercel.app`
- **Redirect URLs:** add `https://product-compass-lilac.vercel.app/**`
  (the app sends the user to `${origin}/auth/callback?next=…`; if this origin isn't allow-listed
  the magic link silently fails — the OTP code path still works regardless).

### 4. Confirm
- On prod → **Sign in** → enter your email → you should receive the **6-digit code** within
  seconds (check spam once; after Resend it should inbox). Enter it → you're in.
- The one-tap link should also now work end-to-end (needs step 3).

## After it works
Come back and we run, together: **Stage 14 §c** (sign in with tracked anon data → data re-keys,
one-time toast) and **Stage 15 §0–§f** (the notification flows). A second test account
(any other email you control) lets you play both referral parties.

> Note: the same `RESEND_API_KEY` + verified domain drive Stage 15's notification emails, so
> once this is done the Stage 15 env is already half-configured.
