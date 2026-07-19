// Stage 15 — SERVER-ONLY glue between the referral write-routes and email.
// Builds a Supabase client scoped to the caller's forwarded token (anon key +
// user JWT — NEVER service-role), and runs the fire-and-forget notify: resolve
// recipient/prefs/throttle via the SECURITY DEFINER RPC, then send one email.
// Nothing here throws; the caller must never fail the underlying write on it.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendNotificationEmail } from "@/lib/email";
import { statusChangeEmail, commentEmail } from "@/lib/emailTemplates";
import { logError } from "@/lib/errors";
import { trackServer } from "@/lib/analytics";

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h && /^bearer /i.test(h) ? h.slice(7).trim() : null;
}

export function scopedClientFromToken(token: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Deep-link base: explicit env wins (reliable in emails), else the request origin.
export function baseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

type ResolveRow = {
  allowed: boolean;
  reason: string;
  recipient_email: string | null;
  recipient_role: "referee" | "referrer" | null;
  role_title: string | null;
  company: string | null;
  unsubscribe_token: string | null;
};

// Resolve → (maybe) send. Never throws; failures land in `errors` (Stage 10).
export async function notifyReferral(
  scoped: SupabaseClient,
  req: Request,
  args: { appId: string; kind: "status" | "comment"; toLabel?: string; body?: string }
): Promise<void> {
  try {
    const { data, error } = await scoped.rpc("resolve_notification", {
      p_app_id: args.appId,
      p_kind: args.kind,
    });
    if (error) {
      await logError("api/referrals/notify", "resolve_notification error", {
        kind: args.kind,
      });
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as ResolveRow | undefined;
    // opted-out / throttled / not-participant / self → silently skip.
    if (!row || !row.allowed || !row.recipient_email) return;

    const base = baseUrl(req);
    const threadUrl = `${base}/referrals/${args.appId}`;
    const unsubscribeUrl = `${base}/api/notifications/unsubscribe?token=${row.unsubscribe_token}`;
    const roleTitle = row.role_title ?? "a referral role";
    const company = row.company ?? "";

    const payload =
      args.kind === "status"
        ? statusChangeEmail({
            roleTitle,
            company,
            toLabel: args.toLabel ?? "updated",
            threadUrl,
            unsubscribeUrl,
          })
        : commentEmail({
            roleTitle,
            company,
            // From the recipient's side: if they're the referrer, the author is
            // the applicant; otherwise the author is the referrer (or admin).
            authorLabel:
              row.recipient_role === "referrer" ? "The applicant" : "The referrer",
            body: args.body ?? "",
            threadUrl,
            unsubscribeUrl,
          });

    const sent = await sendNotificationEmail({ to: row.recipient_email, ...payload });
    await trackServer("notification_sent", { kind: args.kind, sent });
  } catch {
    await logError("api/referrals/notify", "notify threw", { kind: args.kind });
  }
}
