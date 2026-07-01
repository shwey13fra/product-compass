"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Compass,
  Users,
  Loader2,
  AlertTriangle,
  Inbox,
  ArrowRight,
} from "lucide-react";
import { useUser, isAdminEmail } from "@/lib/auth";
import { AuthNav } from "@/components/AuthNav";
import {
  getMyReferralApplications,
  getUnread,
  statusBadgeRole,
  type ReferralApplication,
} from "@/lib/referrals";
import { getRolesByIds } from "@/lib/roles";
import { statusLabel } from "@/lib/applications";
import type { Role } from "@/lib/types";

export default function ReferralsPage() {
  const { user, loading } = useUser();
  const [apps, setApps] = useState<ReferralApplication[] | null>(null);
  const [roles, setRoles] = useState<Map<string, Role>>(new Map());
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    let active = true;
    (async () => {
      const res = await getMyReferralApplications();
      if (!active) return;
      if (!res.ok) {
        setError(res.error);
        setApps([]);
        return;
      }
      setApps(res.data);
      const roleIds = [...new Set(res.data.map((a) => a.role_id))];
      const [rolesRes, unreadRes] = await Promise.all([
        getRolesByIds(roleIds),
        getUnread(user.id),
      ]);
      if (!active) return;
      if (rolesRes.ok) setRoles(new Map(rolesRes.roles.map((r) => [r.id, r])));
      setUnread(unreadRes.unreadIds);
    })();
    return () => {
      active = false;
    };
  }, [user, loading]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 flex items-center justify-between gap-3">
        <Link href="/roles" className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Compass className="h-4 w-4" aria-hidden />
          Product Compass
        </Link>
        <AuthNav />
      </header>

      <h1 className="inline-flex items-center gap-2 font-heading text-3xl font-extrabold tracking-tight text-ink">
        <Users className="h-7 w-7 text-primary" aria-hidden />
        Referrals
      </h1>
      <p className="mt-2 text-sm text-muted">
        Shared applications where you’re the applicant or the referrer.
      </p>

      {loading ? (
        <Loading />
      ) : !user ? (
        <div className="mt-8 rounded-card border border-border bg-surface-alt px-6 py-10 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-accent" aria-hidden />
          <p className="mt-3 text-sm text-muted">Sign in to see your referrals.</p>
          <Link
            href="/signin?next=/referrals"
            className="mt-4 inline-flex min-h-[44px] items-center rounded-btn bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-hover"
          >
            Sign in
          </Link>
        </div>
      ) : error ? (
        <p className="mt-6 inline-flex items-center gap-1.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error}
        </p>
      ) : apps === null ? (
        <Loading />
      ) : apps.length === 0 ? (
        <div className="mt-8 rounded-card border border-dashed border-border bg-surface-alt px-6 py-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-muted" aria-hidden />
          <p className="mt-2 text-sm text-muted">
            No referral applications yet. Apply to a role with a “Referral
            available” badge to start one.
          </p>
          <Link href="/roles" className="mt-4 inline-block text-sm font-semibold text-primary hover:text-primary-hover">
            Browse roles
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {apps.map((app) => {
            const role = roles.get(app.role_id);
            const myRole = statusBadgeRole(app, user.id, user.email, isAdminEmail(user.email));
            return (
              <li key={app.id}>
                <Link
                  href={`/referrals/${app.id}`}
                  className="group flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-[var(--shadow-warm)] transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-bold text-ink">
                      {role ? `${role.title} · ${role.company}` : app.role_id}
                      {unread.has(app.id) ? (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread updates" />
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {myRole} · {statusLabel(app.status)}
                      {app.comment_count > 0 ? ` · ${app.comment_count} message${app.comment_count === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-primary" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function Loading() {
  return (
    <div className="mt-8 flex items-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Loading…
    </div>
  );
}
