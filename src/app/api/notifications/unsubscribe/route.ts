// Stage 15 — one-click unsubscribe from a link in a notification email. No login:
// the capability is the unguessable token. Calls unsubscribe_by_token (SECURITY
// DEFINER, granted to anon) to flip emails_enabled=false, then returns a tiny
// Warm-Clay confirmation page.

import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, message: string): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Product Compass</title></head>
<body style="margin:0;background:#FBF7F2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:440px;margin:12vh auto;padding:32px 28px;background:#fff;border:1px solid #EADFD3;border-radius:14px;text-align:center;">
    <div style="font:600 13px/1.4 sans-serif;color:#D9603F;letter-spacing:.02em;">PRODUCT COMPASS</div>
    <h1 style="margin:14px 0 8px;font-size:20px;color:#2A2320;">${title}</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#7A6E64;">${message}</p>
  </div>
</body></html>`;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token")?.trim();
  if (!token) {
    return page("Invalid link", "This unsubscribe link is missing its token.");
  }
  try {
    const { data, error } = await supabase.rpc("unsubscribe_by_token", {
      p_token: token,
    });
    if (error) {
      await logError("api/notifications/unsubscribe", "rpc error", {});
      return page(
        "Something went wrong",
        "We couldn’t update your preferences. Please try again later."
      );
    }
    if (data === true) {
      return page(
        "You’re unsubscribed",
        "You won’t receive referral notification emails from Product Compass anymore. You can re-enable them anytime from the account menu."
      );
    }
    return page(
      "Link not recognised",
      "This unsubscribe link is invalid or has already been used."
    );
  } catch {
    await logError("api/notifications/unsubscribe", "threw", {});
    return page(
      "Something went wrong",
      "We couldn’t update your preferences. Please try again later."
    );
  }
}
