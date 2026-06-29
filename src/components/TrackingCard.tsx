"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, AlertTriangle, ArrowRight, Compass, FastForward } from "lucide-react";
import type { Role } from "@/lib/types";
import { archetypeLabel } from "@/lib/types";
import type { ExperienceProfile } from "@/lib/experience";
import {
  setStatus,
  backdateStatusChange,
  computeFollowUpNudge,
  statusLabel,
  type Application,
  type ApplicationStatus,
} from "@/lib/applications";
import { getSimilarLiveRoles } from "@/lib/roles";
import { StatusStrip } from "@/components/StatusStrip";
import { WarmPathIntro } from "@/components/WarmPathIntro";

// One tracked role: header + status strip + follow-up nudge + warm/cold hint +
// (when Closed) 3–4 similar live roles. Owns this role's application state and
// persists every change to Supabase via setStatus.
export function TrackingCard({
  role,
  application,
  ownerKey,
  profile,
}: {
  role: Role;
  application: Application;
  ownerKey: string;
  profile: ExperienceProfile | null;
}) {
  const [app, setApp] = useState<Application>(application);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [similar, setSimilar] = useState<Role[] | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);

  const nudge = computeFollowUpNudge(app, role);
  const isClosed = app.status === "closed";

  // When the role is Closed, surface 3–4 similar live roles to move on to.
  useEffect(() => {
    if (!isClosed) {
      setSimilar(null);
      return;
    }
    let cancelled = false;
    setSimilarLoading(true);
    getSimilarLiveRoles(role, 4).then((roles) => {
      if (!cancelled) {
        setSimilar(roles);
        setSimilarLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isClosed, role]);

  async function handleChange(next: ApplicationStatus) {
    setBusy(true);
    setError(null);
    const res = await setStatus(ownerKey, role.id, next);
    if (!res.ok || !res.application) {
      setError(res.ok ? "Could not save." : res.error);
    } else {
      setApp(res.application);
    }
    setBusy(false);
  }

  // Demo only: pretend a week passed since the Seen change, so the time-based
  // follow-up nudge appears without waiting real days.
  async function simulateWeek() {
    setBusy(true);
    setError(null);
    const res = await backdateStatusChange(ownerKey, role.id, app.status_changed_at, 7);
    if (!res.ok || !res.application) {
      setError(res.ok ? "Could not save." : res.error);
    } else {
      setApp(res.application);
    }
    setBusy(false);
  }

  return (
    <article className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/roles/${role.id}`}
            className="font-heading text-lg font-bold text-ink transition-colors hover:text-primary"
          >
            {role.title}
          </Link>
          <p className="mt-0.5 text-sm text-muted">
            {role.company} · {archetypeLabel(role.archetype)}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-alt px-2.5 py-1 text-xs font-semibold text-muted">
          {statusLabel(app.status)}
        </span>
      </header>

      <div className="mt-4">
        <StatusStrip status={app.status} busy={busy} onChange={handleChange} />
      </div>

      {app.status === "seen" && !nudge && (
        <button
          type="button"
          onClick={simulateWeek}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-btn border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
        >
          <FastForward className="h-3.5 w-3.5" aria-hidden />
          Demo: simulate a week passing
        </button>
      )}

      {error && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          {error}
        </p>
      )}

      {nudge && (
        <div className="mt-4 flex items-start gap-2.5 rounded-card border border-accent/30 bg-accent-soft px-3.5 py-3 text-sm text-ink">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>
            <span className="font-semibold">{nudge.message}</span> Seen{" "}
            {nudge.days} {nudge.days === 1 ? "day" : "days"} ago with no movement.
          </span>
        </div>
      )}

      {/* Warm/cold path is only actionable while the application is open —
          once Closed we point at similar live roles instead. */}
      {!isClosed && (
        <div className="mt-4">
          <WarmPathIntro role={role} profile={profile} />
        </div>
      )}

      {isClosed && (
        <div className="mt-4 border-t border-border pt-4">
          <h4 className="inline-flex items-center gap-2 font-heading text-sm font-bold text-ink">
            <Compass className="h-4 w-4 text-primary" aria-hidden />
            Similar live roles to move on to
          </h4>
          {similarLoading ? (
            <div className="mt-3 h-16 animate-pulse rounded-card bg-surface-alt" aria-hidden />
          ) : similar && similar.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {similar.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/roles/${s.id}`}
                    className="flex items-center justify-between gap-3 rounded-btn border border-border bg-surface-alt px-3.5 py-2.5 transition-colors hover:border-primary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {s.title}
                      </span>
                      <span className="block truncate text-xs text-muted">{s.company}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">
              No other live {archetypeLabel(role.archetype)} roles right now —{" "}
              <Link href="/roles" className="font-semibold text-primary underline">
                browse all roles
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </article>
  );
}
