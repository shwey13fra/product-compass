"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Compass,
  AlertTriangle,
  Inbox,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { resolveOwnerKey } from "@/lib/owner";
import { getApplicationsForOwner, type Application } from "@/lib/applications";
import { getRolesByIds } from "@/lib/roles";
import { loadExperience, type ExperienceProfile } from "@/lib/experience";
import type { Role } from "@/lib/types";
import { TrackingCard } from "@/components/TrackingCard";

type Loaded = {
  applications: Application[];
  rolesById: Map<string, Role>;
  ownerKey: string;
};
type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: Loaded };

export default function TrackingPage() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [profile, setProfile] = useState<ExperienceProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const uid = await resolveOwnerKey();
      if (cancelled) return;
      setProfile(loadExperience());
      if (!uid) {
        if (!cancelled)
          setState({
            phase: "ready",
            data: { applications: [], rolesById: new Map(), ownerKey: "" },
          });
        return;
      }

      const apps = await getApplicationsForOwner(uid);
      if (cancelled) return;
      if (!apps.ok) {
        setState({ phase: "error", message: apps.error });
        return;
      }

      const ids = apps.applications.map((a) => a.role_id);
      const roles = await getRolesByIds(ids);
      if (cancelled) return;
      if (!roles.ok) {
        setState({ phase: "error", message: roles.error });
        return;
      }

      const rolesById = new Map(roles.roles.map((r) => [r.id, r]));
      setState({
        phase: "ready",
        data: { applications: apps.applications, rolesById, ownerKey: uid },
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href="/roles"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All roles
      </Link>

      <header className="mt-6">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Compass className="h-4 w-4" aria-hidden />
          Product Compass
        </span>
        <h1 className="mt-2 font-heading text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Tracking
        </h1>
        <p className="mt-2 max-w-2xl text-base text-muted">
          Every role you&apos;ve applied to, with where it stands and what to do
          next. Saved on this device.
        </p>
      </header>

      <div className="mt-8">
        {state.phase === "loading" && <LoadingState />}
        {state.phase === "error" && <ErrorState message={state.message} />}
        {state.phase === "ready" && (
          <ReadyState data={state.data} profile={profile} />
        )}
      </div>
    </main>
  );
}

function ReadyState({
  data,
  profile,
}: {
  data: Loaded;
  profile: ExperienceProfile | null;
}) {
  // Applications already arrive newest-first; only show ones whose role resolved.
  const cards = data.applications
    .map((app) => ({ app, role: data.rolesById.get(app.role_id) }))
    .filter((x): x is { app: Application; role: Role } => !!x.role);

  if (cards.length === 0) return <EmptyState />;

  return (
    <div className="space-y-4">
      {cards.map(({ app, role }) => (
        <TrackingCard
          key={app.id}
          role={role}
          application={app}
          ownerKey={data.ownerKey || app.owner_key}
          profile={profile}
        />
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center gap-2.5 rounded-card border border-border bg-surface-alt px-6 py-16 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
      Loading your tracked roles…
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-danger/30 bg-danger-soft px-6 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-danger" aria-hidden />
      <h2 className="mt-4 font-heading text-lg font-bold text-ink">
        Couldn&apos;t load your tracking
      </h2>
      <p className="mt-1.5 max-w-md text-sm text-muted">{message}</p>
      <p className="mt-1 text-xs text-muted">
        Make sure the <code>applications</code> table exists (see{" "}
        <code>scripts/applications-table.sql</code>), then reload.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border bg-surface-alt px-6 py-16 text-center">
      <Inbox className="h-8 w-8 text-muted" aria-hidden />
      <h2 className="mt-4 font-heading text-lg font-bold text-ink">
        Nothing tracked yet
      </h2>
      <p className="mt-1.5 max-w-md text-sm text-muted">
        Find a role and hit “Mark as Applied” — it&apos;ll show up here with a
        status strip and follow-up nudges.
      </p>
      <Link
        href="/roles"
        className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white shadow-[var(--shadow-warm)] transition-colors hover:bg-primary-hover"
      >
        <Compass className="h-4 w-4" aria-hidden />
        Browse roles
      </Link>
    </div>
  );
}
