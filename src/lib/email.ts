// Stage 15 — email sending via Resend. SERVER-ONLY (holds RESEND_API_KEY via
// process.env; never import from a client component). Fire-and-forget in spirit:
// never throws, logs failures to the Stage 10 `errors` table, and returns a
// boolean so the caller can record whether the send happened — but the caller
// must NOT let a false result fail the underlying action.

import { Resend } from "resend";
import { logError } from "@/lib/errors";

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendNotificationEmail(p: EmailPayload): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) {
    await logError("email", "missing RESEND_API_KEY or RESEND_FROM", {
      hasKey: !!key,
      hasFrom: !!from,
    });
    return false;
  }
  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      from,
      to: p.to,
      subject: p.subject,
      html: p.html,
      text: p.text,
    });
    if (error) {
      // error.name/message are Resend's, not secrets — safe to log the name.
      await logError("email/send", "resend returned error", { name: error.name });
      return false;
    }
    return true;
  } catch {
    await logError("email/send", "resend threw", {});
    return false;
  }
}
