// Stage 15 — Warm-Clay notification email templates. Pure functions, no secrets,
// no I/O. Email clients strip <style>/external CSS and ignore Tailwind, so every
// style is INLINE. Each builder returns { subject, html, text } — the plain-text
// alternative is required (deliverability + accessibility).
//
// PII rule: statusChangeEmail carries NO comment text; commentEmail includes the
// body because only the two thread parties ever receive it (enforced upstream by
// resolve_notification).

const C = {
  bg: "#FBF7F2",
  surface: "#FFFFFF",
  border: "#EADFD3",
  ink: "#2A2320",
  muted: "#7A6E64",
  primary: "#D9603F",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Shared shell: warm background, centered card, terracotta CTA, muted footer with
// the unsubscribe link. `innerHtml` is trusted (built from escaped pieces here).
function shell(opts: {
  heading: string;
  innerHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  unsubscribeUrl: string;
}): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${C.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${C.surface};border:1px solid ${C.border};border-radius:14px;overflow:hidden;">
        <tr><td style="padding:28px 28px 8px 28px;">
          <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.primary};letter-spacing:.02em;">PRODUCT COMPASS</div>
          <h1 style="margin:12px 0 0 0;font:800 20px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">${escapeHtml(opts.heading)}</h1>
        </td></tr>
        <tr><td style="padding:12px 28px 4px 28px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.ink};">
          ${opts.innerHtml}
        </td></tr>
        <tr><td style="padding:20px 28px 28px 28px;">
          <a href="${opts.ctaUrl}" style="display:inline-block;background:${C.primary};color:#fff;text-decoration:none;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:13px 22px;border-radius:10px;">${escapeHtml(opts.ctaLabel)}</a>
        </td></tr>
        <tr><td style="padding:0 28px 24px 28px;border-top:1px solid ${C.border};">
          <p style="margin:16px 0 0 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.muted};">
            You get these because you're part of this referral thread on Product Compass.
            <a href="${opts.unsubscribeUrl}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export type StatusEmailInput = {
  roleTitle: string;
  company: string;
  toLabel: string; // human status label, e.g. "Shortlisted"
  threadUrl: string;
  unsubscribeUrl: string;
};

// "Title at Company" — but drop the " at " when company is unknown.
function roleLine(roleTitle: string, company: string): string {
  return company.trim() ? `${roleTitle} at ${company}` : roleTitle;
}

export function statusChangeEmail(i: StatusEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const role = roleLine(i.roleTitle, i.company);
  const subject = `${i.roleTitle} · now ${i.toLabel}`;
  const html = shell({
    heading: "A referral moved forward",
    innerHtml: `<p style="margin:0 0 10px 0;">Your referral for <strong>${escapeHtml(
      role
    )}</strong> is now <strong>${escapeHtml(i.toLabel)}</strong>.</p>
    <p style="margin:0;color:${C.muted};font-size:14px;">Open the thread to see where it stands and reply.</p>`,
    ctaLabel: "Open the thread",
    ctaUrl: i.threadUrl,
    unsubscribeUrl: i.unsubscribeUrl,
  });
  const text = `Product Compass — a referral moved forward

Your referral for ${role} is now ${i.toLabel}.

Open the thread: ${i.threadUrl}

Unsubscribe: ${i.unsubscribeUrl}`;
  return { subject, html, text };
}

export type CommentEmailInput = {
  roleTitle: string;
  company: string;
  authorLabel: string; // "The referrer" / "The applicant" — no raw email
  body: string;
  threadUrl: string;
  unsubscribeUrl: string;
};

export function commentEmail(i: CommentEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const role = roleLine(i.roleTitle, i.company);
  const subject = `New message · ${i.roleTitle}`;
  const html = shell({
    heading: "New message in your referral thread",
    innerHtml: `<p style="margin:0 0 10px 0;color:${C.muted};font-size:14px;">${escapeHtml(
      i.authorLabel
    )} on <strong style="color:${C.ink};">${escapeHtml(role)}</strong>:</p>
    <blockquote style="margin:0;padding:12px 14px;background:${C.bg};border-left:3px solid ${C.primary};border-radius:8px;white-space:pre-wrap;">${escapeHtml(
      i.body
    )}</blockquote>`,
    ctaLabel: "Reply in the thread",
    ctaUrl: i.threadUrl,
    unsubscribeUrl: i.unsubscribeUrl,
  });
  const text = `Product Compass — new message in your referral thread

${i.authorLabel} on ${role}:

${i.body}

Reply: ${i.threadUrl}

Unsubscribe: ${i.unsubscribeUrl}`;
  return { subject, html, text };
}
