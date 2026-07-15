"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Shield,
  Compass,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Plus,
  MessageSquare,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { useUser, isAdminEmail } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { AuthNav } from "@/components/AuthNav";
import { LastSyncCard } from "@/components/LastSyncCard";
import type { IngestSummary } from "@/lib/ingest/types";
import {
  ALL_ARCHETYPES,
  ARCHETYPE_LABELS,
  archetypeLabel,
  type Archetype,
  type Role,
} from "@/lib/types";
import {
  STATUS_STEPS,
  statusLabel,
  type ApplicationStatus,
} from "@/lib/applications";
import {
  adminCreateReferralRole,
  getMyReferralApplications,
  getProfileEmails,
  setReferralStatus,
  type ReferralApplication,
} from "@/lib/referrals";
import { getRolesByIds } from "@/lib/roles";

export default function AdminPage() {
  const { user, loading } = useUser();
  const admin = isAdminEmail(user?.email);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex items-center justify-between gap-3">
        <Link
          href="/roles"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary"
        >
          <Compass className="h-4 w-4" aria-hidden />
          Product Compass
        </Link>
        <AuthNav />
      </header>

      <h1 className="inline-flex items-center gap-2 font-heading text-3xl font-extrabold tracking-tight text-ink">
        <Shield className="h-7 w-7 text-primary" aria-hidden />
        Admin
      </h1>

      {loading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Checking access…
        </div>
      ) : !user ? (
        <Gate
          title="Sign in required"
          body="The admin view is for referral moderators. Sign in with an admin email."
          cta={{ href: "/signin?next=/admin", label: "Sign in" }}
        />
      ) : !admin ? (
        <Gate
          title="Not authorized"
          body={`${user.email} isn’t an admin. Ask to be added to ADMIN_EMAILS.`}
        />
      ) : (
        <div className="mt-6 space-y-8">
          <SyncJobsPanel />
          <PostReferralForm />
          <ReferralOverview />
        </div>
      )}
    </main>
  );
}

function Gate({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="mt-8 rounded-card border border-border bg-surface-alt px-6 py-10 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-accent" aria-hidden />
      <h2 className="mt-3 font-heading text-lg font-bold text-ink">{title}</h2>
      <p className="mt-1.5 text-sm text-muted">{body}</p>
      {cta ? (
        <Link
          href={cta.href}
          className="mt-4 inline-flex min-h-[44px] items-center rounded-btn bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

// --- Stage 8: trigger a job sync ---------------------------------------------

function SyncJobsPanel() {
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [summary, setSummary] = useState<IngestSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setState("syncing");
    setError(null);
    setSummary(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setError("Session expired — sign in again.");
      setState("error");
      return;
    }
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Sync failed.");
        setState("error");
        return;
      }
      setSummary(body as IngestSummary);
      setState("done");
    } catch {
      setError("Network error — try again.");
      setState("error");
    }
  }

  return (
    <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
      <h2 className="inline-flex items-center gap-2 font-heading text-lg font-bold text-ink">
        <RefreshCw className="h-4 w-4 text-primary" aria-hidden />
        Sync jobs
      </h2>
      <p className="mt-1 text-sm text-muted">
        Pull PM roles from the configured Greenhouse, Lever, and Adzuna sources.
        No AI credits used.
      </p>

      <button
        type="button"
        onClick={sync}
        disabled={state === "syncing"}
        className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {state === "syncing" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
        {state === "syncing" ? "Syncing…" : "Sync jobs now"}
      </button>

      {state === "error" && error ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error}
        </p>
      ) : null}

      {state === "done" && summary ? (
        <div className="mt-4 rounded-card border border-border bg-surface-alt px-4 py-3 text-sm text-ink">
          <p className="font-semibold">
            <span className="text-success">{summary.added} added</span> ·{" "}
            {summary.updated} updated · {summary.expired} expired
          </p>
          <p className="mt-1 text-xs text-muted">
            Greenhouse {summary.bySource.greenhouse.fetched} · Lever{" "}
            {summary.bySource.lever.fetched} · Adzuna {summary.bySource.adzuna.fetched}
          </p>
          {summary.warnings.length > 0 ? (
            <ul className="mt-2 space-y-1 rounded-btn border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-xs text-ink">
              {summary.warnings.map((w, i) => (
                <li key={i} className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
          {summary.errors.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-accent">
              {summary.errors.map((e, i) => (
                <li key={i} className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {e}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Durable last-run summary — survives reloads and shows the nightly cron's
          results, not just a sync you triggered in this session. */}
      <LastSyncCard />
    </section>
  );
}

// --- Post a referral job -----------------------------------------------------

function PostReferralForm() {
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [archetype, setArchetype] = useState<Archetype>("ai");
  const [score, setScore] = useState("75");
  const [location, setLocation] = useState("");
  const [referrerEmail, setReferrerEmail] = useState("");
  const [jd, setJd] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const n = Number(score);
    if (!company.trim() || !title.trim()) {
      setError("Company and title are required.");
      setState("error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(referrerEmail.trim())) {
      setError("Enter a valid referrer email.");
      setState("error");
      return;
    }
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setError("Real-PM score must be 0–100.");
      setState("error");
      return;
    }

    setState("saving");
    const res = await adminCreateReferralRole({
      company,
      title,
      archetype,
      real_pm_score: Math.round(n),
      location: location || null,
      jd_text: jd || null,
      referrer_email: referrerEmail,
    });
    if (!res.ok) {
      setError(res.error);
      setState("error");
      return;
    }
    setState("ok");
    setCompany("");
    setTitle("");
    setLocation("");
    setReferrerEmail("");
    setJd("");
    setScore("75");
  }

  return (
    <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
      <h2 className="inline-flex items-center gap-2 font-heading text-lg font-bold text-ink">
        <Plus className="h-4 w-4 text-primary" aria-hidden />
        Post a referral job
      </h2>
      <p className="mt-1 text-sm text-muted">
        Posts a role with a “Referral available” badge. Applicants must sign in;
        applying opens a private thread with the tagged referrer.
      </p>

      <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company">
          <input className={inputCls} value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label="Title">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Archetype">
          <select
            className={inputCls}
            value={archetype}
            onChange={(e) => setArchetype(e.target.value as Archetype)}
          >
            {ALL_ARCHETYPES.map((a) => (
              <option key={a} value={a}>
                {ARCHETYPE_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Real-PM score (0–100)">
          <input
            className={inputCls}
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
        </Field>
        <Field label="Location">
          <input className={inputCls} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Remote · Bengaluru" />
        </Field>
        <Field label="Referrer email (tagged)">
          <input className={inputCls} type="email" value={referrerEmail} onChange={(e) => setReferrerEmail(e.target.value)} placeholder="referrer@example.com" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Job description">
            <textarea
              className={`${inputCls} min-h-[120px] py-2`}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
            />
          </Field>
        </div>

        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={state === "saving"}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {state === "saving" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Post referral role
          </button>
          {state === "ok" ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Posted — it’s live in the roles list.
            </span>
          ) : null}
          {state === "error" && error ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {error}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

const inputCls =
  "min-h-[44px] w-full rounded-btn border border-border bg-bg px-3 text-sm text-ink outline-none focus:border-primary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

// --- Referral applications overview (status + thread-exists, NOT contents) ---

function ReferralOverview() {
  const [apps, setApps] = useState<ReferralApplication[] | null>(null);
  const [roles, setRoles] = useState<Map<string, Role>>(new Map());
  const [emails, setEmails] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await getMyReferralApplications(); // admin → all rows (RLS)
    if (!res.ok) {
      setError(res.error);
      setApps([]);
      return;
    }
    setApps(res.data);

    const roleIds = [...new Set(res.data.map((a) => a.role_id))];
    const refereeIds = [...new Set(res.data.map((a) => a.referee_id))];
    const [rolesRes, emailMap] = await Promise.all([
      getRolesByIds(roleIds),
      getProfileEmails(refereeIds),
    ]);
    if (rolesRes.ok) setRoles(new Map(rolesRes.roles.map((r) => [r.id, r])));
    setEmails(emailMap);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function override(id: string, status: ApplicationStatus) {
    const res = await setReferralStatus(id, status);
    if (res.ok) {
      setApps((prev) =>
        (prev ?? []).map((a) => (a.id === id ? res.data : a))
      );
    } else {
      setError(res.error);
    }
  }

  return (
    <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
      <h2 className="font-heading text-lg font-bold text-ink">
        Referral applications
      </h2>
      <p className="mt-1 text-sm text-muted">
        You can see status and whether a private thread exists — never its
        contents (enforced by row-level security).
      </p>

      {error ? (
        <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error}
        </p>
      ) : null}

      {apps === null ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : apps.length === 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-border bg-surface-alt px-6 py-10 text-center">
          <Inbox className="mx-auto h-7 w-7 text-muted" aria-hidden />
          <p className="mt-2 text-sm text-muted">
            No referral applications yet.
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {apps.map((app) => {
            const role = roles.get(app.role_id);
            return (
              <li key={app.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {role ? `${role.title} · ${role.company}` : app.role_id}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {role ? `${archetypeLabel(role.archetype)} · ` : ""}
                    referee {emails.get(app.referee_id) ?? "—"} · referrer{" "}
                    {app.referrer_email}
                  </p>
                </div>

                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                  {app.comment_count > 0
                    ? `Thread · ${app.comment_count} ${app.comment_count === 1 ? "message" : "messages"}`
                    : "No thread yet"}
                </span>

                <label className="text-xs">
                  <span className="sr-only">Override status</span>
                  <select
                    value={app.status}
                    onChange={(e) =>
                      override(app.id, e.target.value as ApplicationStatus)
                    }
                    className="min-h-[36px] rounded-btn border border-border bg-bg px-2 text-xs font-semibold text-ink outline-none focus:border-primary"
                    title="Override status"
                  >
                    {STATUS_STEPS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {statusLabel(s.key)}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
