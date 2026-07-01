import Link from "next/link";
import { MapPin, ArrowUpRight, Users } from "lucide-react";
import type { Role } from "@/lib/types";
import type { MatchResult } from "@/lib/preferences";
import {
  ArchetypeTag,
  ScoreBadge,
  FreshnessFlag,
  FitTag,
  ReasonChip,
  ReferralBadge,
} from "@/components/role-badges";

// A single role as a clickable card. Whole card links to the detail view.
// `match` is optional Stage 2.5 personalisation; when present we show the
// fit tag + reason chip.
export function RoleCard({ role, match }: { role: Role; match?: MatchResult }) {
  return (
    <Link
      href={`/roles/${role.id}`}
      className="group flex flex-col rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] transition-all hover:border-primary/40 hover:shadow-[0_2px_4px_rgba(42,35,32,0.06),0_12px_28px_rgba(42,35,32,0.10)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {match && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FitTag fit={match.fit} />
          <ReasonChip reasons={match.reasons} />
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-lg font-bold text-ink">
            {role.title}
          </h3>
          <p className="mt-0.5 truncate text-sm font-medium text-muted">
            {role.company}
          </p>
        </div>
        <ArrowUpRight className="h-5 w-5 shrink-0 text-muted transition-colors group-hover:text-primary" aria-hidden />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ScoreBadge score={role.real_pm_score} />
        <ArchetypeTag archetype={role.archetype} />
        {role.is_referral && <ReferralBadge />}
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 text-xs text-muted">
        {role.location && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {role.location}
          </span>
        )}
        <FreshnessFlag isLive={role.is_live} checkedAt={role.freshness_checked_at} />
        {role.has_warm_path && (
          <span className="inline-flex items-center gap-1.5 text-primary">
            <Users className="h-3.5 w-3.5" aria-hidden />
            Warm path available
          </span>
        )}
      </div>
    </Link>
  );
}
