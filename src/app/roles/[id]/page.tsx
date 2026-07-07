import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Users,
  Clock,
  FileText,
  Target,
  AlertTriangle,
} from "lucide-react";
import { getRoleById } from "@/lib/roles";
import { getBand } from "@/lib/types";
import {
  ArchetypeTag,
  ScoreBadge,
  FreshnessFlag,
  ReferralBadge,
  SourceBadge,
} from "@/components/role-badges";
import { PositioningPanel } from "@/components/PositioningPanel";
import { ApplyButton } from "@/components/ApplyButton";
import { ReferralApplyButton } from "@/components/ReferralApplyButton";
import { ApplyOutButton } from "@/components/ApplyOutButton";
import { sourceLabel } from "@/components/role-badges";

export const dynamic = "force-dynamic";

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getRoleById(id);

  if (!result.ok && result.notFound) notFound();

  if (!result.ok) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <BackLink />
        <div className="mt-6 flex flex-col items-center justify-center rounded-card border border-danger/30 bg-danger-soft px-6 py-16 text-center">
          <AlertTriangle className="h-8 w-8 text-danger" aria-hidden />
          <h2 className="mt-4 font-heading text-lg font-bold text-ink">
            Couldn’t load this role
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-muted">{result.error}</p>
        </div>
      </main>
    );
  }

  const role = result.role;
  const band = getBand(role.real_pm_score);
  const signals = (role.real_pm_signals ?? []).slice(0, 3);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <BackLink />

      {/* Header */}
      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          <ArchetypeTag archetype={role.archetype} />
          <FreshnessFlag isLive={role.is_live} checkedAt={role.freshness_checked_at} />
          {role.is_referral && <ReferralBadge />}
          <SourceBadge source={role.source} />
        </div>
        <h1 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          {role.title}
        </h1>
        <p className="mt-1 text-lg font-medium text-muted">{role.company}</p>
        {role.location && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted">
            <MapPin className="h-4 w-4" aria-hidden />
            {role.location}
          </p>
        )}

        {/* Referral roles (Stage 7) require sign-in + open a shared thread;
            ingested roles (Stage 8) link out to apply_url; ordinary roles use
            the anonymous compass_uid tracking (Stage 5). Wrapped in a block so
            the CTA sits BELOW the inline location, never beside it. */}
        <div>
          {role.is_referral ? (
            <ReferralApplyButton role={role} />
          ) : role.apply_url ? (
            <ApplyOutButton url={role.apply_url} source={sourceLabel(role.source)} />
          ) : (
            <ApplyButton roleId={role.id} />
          )}
        </div>
      </header>

      {/* Real-PM score + signals */}
      <section
        className={`mt-6 rounded-card border bg-surface p-5 shadow-[var(--shadow-warm)] ring-1 ${band.ringClass}`}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="inline-flex items-center gap-2 font-heading text-base font-bold text-ink">
            <Target className="h-4 w-4 text-muted" aria-hidden />
            Real-PM score
          </h2>
          <ScoreBadge score={role.real_pm_score} size="lg" />
        </div>

        {signals.length > 0 ? (
          <>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
              Top signals
            </p>
            <ul className="mt-2 space-y-2">
              {signals.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-ink">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${band.textClass}`}
                    aria-hidden
                  />
                  {s}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">No signals recorded.</p>
        )}
      </section>

      {/* Crowd + warm path */}
      <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)]">
          <h2 className="inline-flex items-center gap-2 font-heading text-sm font-bold text-ink">
            <Clock className="h-4 w-4 text-info" aria-hidden />
            Crowd response time
          </h2>
          {role.crowd_response_days != null ? (
            <p className="mt-2 text-sm text-muted">
              Applicants typically hear back in about{" "}
              <span className="font-semibold text-ink">
                {role.crowd_response_days}{" "}
                {role.crowd_response_days === 1 ? "day" : "days"}
              </span>
              .
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">No crowd data yet.</p>
          )}
        </div>

        <div className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)]">
          <h2 className="inline-flex items-center gap-2 font-heading text-sm font-bold text-ink">
            <Users
              className={`h-4 w-4 ${role.has_warm_path ? "text-success" : "text-muted"}`}
              aria-hidden
            />
            Warm path
          </h2>
          {role.has_warm_path ? (
            <p className="mt-2 text-sm text-muted">
              <span className="font-semibold text-success">Available.</span>{" "}
              {role.warm_path_note ?? "A referral route exists for this role."}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">
              No warm path found — this is a cold-path application.
            </p>
          )}
        </div>
      </section>

      {/* Job description */}
      <section className="mt-4 rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
        <h2 className="inline-flex items-center gap-2 font-heading text-base font-bold text-ink">
          <FileText className="h-4 w-4 text-muted" aria-hidden />
          Job description
        </h2>
        {role.jd_text ? (
          <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/90">
            {role.jd_text}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            No job description provided for this role.
          </p>
        )}
      </section>

      {/* Stage 3 — manual positioning (prompt out, JSON in) + fit read */}
      <PositioningPanel role={role} />
    </main>
  );
}

function BackLink() {
  return (
    <Link
      href="/roles"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-primary"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      All roles
    </Link>
  );
}
