"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Compass,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Lock,
  Send,
  MessagesSquare,
} from "lucide-react";
import { useUser, isAdminEmail } from "@/lib/auth";
import { AuthNav } from "@/components/AuthNav";
import { StatusStrip } from "@/components/StatusStrip";
import {
  getReferralApplication,
  getComments,
  addComment,
  setReferralStatus,
  markRead,
  viewerRole,
  allowedStatusesFor,
  isDormant,
  type ReferralApplication,
  type Comment,
} from "@/lib/referrals";
import { statusLabel, type ApplicationStatus } from "@/lib/applications";
import { getRoleById } from "@/lib/roles";
import { track } from "@/lib/analytics";
import type { Role } from "@/lib/types";

export default function ReferralThreadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user, loading } = useUser();

  const [app, setApp] = useState<ReferralApplication | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const admin = isAdminEmail(user?.email);
  const role_ = app ? viewerRole(app, user?.id ?? "", user?.email, admin) : "none";
  const isParticipant = role_ === "referee" || role_ === "referrer";
  const isAdminOnly = role_ === "admin";

  const dormant = app ? isDormant(app) : false;
  const canAdminClose = isAdminOnly && dormant && app?.status !== "closed";

  // Referee's strip is read-only (they use the Withdraw button); admin can click
  // Close only when the thread is dormant. Mirrors set_referral_status() server-side.
  const allowed: ApplicationStatus[] =
    role_ === "admin"
      ? canAdminClose
        ? ["closed"]
        : []
      : role_ === "referee"
        ? []
        : allowedStatusesFor(role_);

  const statusHint =
    role_ === "referrer"
      ? "You drive these updates — mark Seen, Shared with HM, or Shortlisted as things move. Close it when it wraps."
      : role_ === "referee"
        ? "The referrer drives these stages. If you need to step away, withdraw below."
        : role_ === "admin"
          ? app?.status === "closed"
            ? "This referral is closed."
            : dormant
              ? "Inactive for 90+ days — you can close this thread as cleanup."
              : "Admin view. You can only close a thread after 90 days of inactivity."
          : undefined;

  // Warm, role-aware nudge for an empty thread + a starter placeholder.
  const threadPrompt =
    role_ === "referrer"
      ? "This is your private line with the applicant. Say hi, let them know you’ve got their back, and tell them what would help you make the intro — a short blurb, their resume, anything."
      : "This is your private line with your referrer. Introduce yourself warmly, share why this role genuinely fits you, and ask what would help them refer you.";
  const threadPlaceholder =
    role_ === "referrer"
      ? "Hi! Happy to help with this — could you send a short blurb I can pass along?"
      : "Hi! Thank you so much for the referral — here’s why I’m excited about this role…";

  // Load application + role; participants also load comments + mark read.
  useEffect(() => {
    if (loading || !user) return;
    let active = true;
    (async () => {
      const res = await getReferralApplication(id);
      if (!active) return;
      if (!res.ok) {
        setError(res.error);
        setReady(true);
        return;
      }
      setApp(res.data);
      if (res.data) {
        const r = viewerRole(res.data, user.id, user.email, isAdminEmail(user.email));
        const [roleRes, commentsRes] = await Promise.all([
          getRoleById(res.data.role_id),
          r === "referee" || r === "referrer"
            ? getComments(id)
            : Promise.resolve(null),
        ]);
        if (!active) return;
        if (roleRes.ok) setRole(roleRes.role);
        if (commentsRes && commentsRes.ok) setComments(commentsRes.data);
        if (r === "referee" || r === "referrer") markRead(id, user.id);
      }
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [id, user, loading]);

  async function changeStatus(next: ApplicationStatus) {
    if (!app || !user) return;
    setBusy(true);
    setError(null);
    const from = app.status;
    const res = await setReferralStatus(app.id, next);
    if (res.ok) {
      setApp(res.data);
      track("status_changed", { from, to: next });
      if (isParticipant) markRead(app.id, user.id);
    } else {
      setError(res.error);
    }
    setBusy(false);
  }

  async function withdraw() {
    if (!app) return;
    const ok = window.confirm(
      "Withdraw your application? This closes the referral for both of you."
    );
    if (!ok) return;
    await changeStatus("closed");
  }

  async function postComment(body: string) {
    if (!app || !user) return;
    const res = await addComment(app.id, user.id, user.email ?? null, body);
    if (res.ok) {
      setComments((prev) => [...(prev ?? []), res.data]);
      // No message content in the event — PII rule (docs/METRICS.md).
      track("referral_thread_message", { role_id: app.role_id });
      markRead(app.id, user.id);
    } else {
      setError(res.error);
    }
    return res.ok;
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6 flex items-center justify-between gap-3">
        <Link href="/roles" className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Compass className="h-4 w-4" aria-hidden />
          Product Compass
        </Link>
        <AuthNav />
      </header>

      <Link
        href="/referrals"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All referrals
      </Link>

      {loading || !ready ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : !user ? (
        <NoAccess
          title="Sign in required"
          body="Sign in to view this shared referral."
          href={`/signin?next=${encodeURIComponent(`/referrals/${id}`)}`}
        />
      ) : !app ? (
        <NoAccess
          title="Not found"
          body="This referral doesn’t exist, or you don’t have access to it."
        />
      ) : (
        <div className="mt-6 space-y-6">
          {/* Role + shared status strip */}
          <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)]">
            <h1 className="font-heading text-xl font-bold text-ink">
              {role ? `${role.title}` : "Referral"}
            </h1>
            {role ? <p className="text-sm text-muted">{role.company}</p> : null}
            <p className="mt-1 text-xs text-muted">
              Shared with the applicant and referrer ({app.referrer_email}).
              {isAdminOnly ? " You are viewing as admin." : ""}
            </p>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Status · {statusLabel(app.status)}
              </p>
              <StatusStrip
                status={app.status}
                busy={busy}
                onChange={changeStatus}
                allowed={allowed}
                hint={statusHint}
                closeConfirm={
                  isAdminOnly
                    ? "Close this referral? It’s been inactive for 90+ days and you won’t be able to re-open it."
                    : undefined
                }
              />
              {role_ === "referee" && app.status !== "closed" ? (
                <button
                  type="button"
                  onClick={withdraw}
                  disabled={busy}
                  className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-btn border border-danger/40 bg-danger-soft px-4 text-sm font-semibold text-danger transition-colors hover:border-danger/60 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  Withdraw application
                </button>
              ) : null}
            </div>
          </section>

          {/* Private comment thread — referee + referrer ONLY */}
          <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)]">
            <h2 className="inline-flex items-center gap-2 font-heading text-base font-bold text-ink">
              <MessagesSquare className="h-4 w-4 text-primary" aria-hidden />
              Private thread
            </h2>

            {isAdminOnly ? (
              <div className="mt-3 flex items-start gap-2 rounded-card border border-border bg-surface-alt px-4 py-3 text-sm text-muted">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  This thread is private to the applicant and referrer and is
                  hidden from admins — even you. You can see that{" "}
                  {app.comment_count > 0
                    ? `${app.comment_count} message${app.comment_count === 1 ? "" : "s"} exist`
                    : "no messages exist yet"}
                  , but not their contents.
                </span>
              </div>
            ) : isParticipant ? (
              <Thread
                comments={comments}
                meId={user.id}
                refereeId={app.referee_id}
                onPost={postComment}
                emptyPrompt={threadPrompt}
                placeholder={threadPlaceholder}
              />
            ) : (
              <p className="mt-3 text-sm text-muted">
                You don’t have access to this thread.
              </p>
            )}

            {/* // TODO(v2): email notifications on new comment / status change. */}
            <p className="mt-3 text-xs text-muted">
              Updates show an unread dot in the nav. Email notifications come
              later.
            </p>
          </section>

          {error ? (
            <p className="inline-flex items-center gap-1.5 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {error}
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}

function Thread({
  comments,
  meId,
  refereeId,
  onPost,
  emptyPrompt,
  placeholder,
}: {
  comments: Comment[] | null;
  meId: string;
  refereeId: string;
  onPost: (body: string) => Promise<boolean | undefined>;
  emptyPrompt: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [comments?.length]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await onPost(body);
    if (ok) setDraft("");
    setSending(false);
  }

  return (
    <div className="mt-3">
      {comments === null ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading messages…
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-card border border-dashed border-primary/30 bg-primary-soft/40 px-4 py-3">
          <p className="text-sm text-ink">{emptyPrompt}</p>
          <p className="mt-1 text-xs text-muted">
            Only you and the other party can read this — never admins.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const mine = c.author_id === meId;
            const who = mine
              ? "You"
              : c.author_email ??
                (c.author_id === refereeId ? "Applicant" : "Referrer");
            return (
              <li
                key={c.id}
                className={`max-w-[85%] rounded-card px-3.5 py-2.5 text-sm ${
                  mine
                    ? "ml-auto bg-primary-soft text-ink"
                    : "bg-surface-alt text-ink"
                }`}
              >
                <p className="mb-0.5 text-xs font-semibold text-muted">{who}</p>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            );
          })}
          <div ref={endRef} />
        </ul>
      )}

      <div className="mt-4 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
          }}
          rows={2}
          placeholder={placeholder}
          className="min-h-[44px] w-full resize-y rounded-btn border border-border bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !draft.trim()}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          Send
        </button>
      </div>
    </div>
  );
}

function NoAccess({
  title,
  body,
  href,
}: {
  title: string;
  body: string;
  href?: string;
}) {
  return (
    <div className="mt-8 rounded-card border border-border bg-surface-alt px-6 py-10 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-accent" aria-hidden />
      <h2 className="mt-3 font-heading text-lg font-bold text-ink">{title}</h2>
      <p className="mt-1.5 text-sm text-muted">{body}</p>
      {href ? (
        <Link
          href={href}
          className="mt-4 inline-flex min-h-[44px] items-center rounded-btn bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          Sign in
        </Link>
      ) : null}
    </div>
  );
}
