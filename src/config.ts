// Single source of truth for the app name (CLAUDE.md rule).
export const APP_NAME = "Product Compass";

// Stage 7 — admins (see the Admin view + referral moderation).
// IMPORTANT: this list drives the UI only. Postgres RLS enforces admin access
// via the public.is_admin() SQL function in scripts/stage7-auth-referrals.sql —
// keep the two email lists IN SYNC. Emails are compared case-insensitively.
export const ADMIN_EMAILS: string[] = [
  "sabbyicon@gmail.com",
  "shwetaswain13november@gmail.com",
];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return ADMIN_EMAILS.some((a) => a.trim().toLowerCase() === e);
}

// Stage 8 — job ingestion sources. These board tokens are NOT secret (they
// appear in public URLs). Add a company's token/slug here to include it in the
// next admin "Sync jobs now". Adzuna keys are secret → server env only.
export const GREENHOUSE_BOARDS: string[] = [
  "stripe", // boards.greenhouse.io/stripe — many PM roles; smoke-test source
];
export const LEVER_COMPANIES: string[] = [
  // e.g. "netflix" — from jobs.lever.co/{company}
];
