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
