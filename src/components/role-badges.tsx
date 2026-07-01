import { CheckCircle2, AlertTriangle, ShieldX, Clock, HelpCircle, UserCheck } from "lucide-react";
import {
  archetypeLabel,
  getBand,
  getFreshness,
  type FreshnessMeta,
} from "@/lib/types";

// Small, reusable presentational pieces shared by the card and detail views.
// All color comes from Warm Clay semantic tokens (sage / honey / brick),
// never hardcoded hex.

export function ArchetypeTag({ archetype }: { archetype: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-info-soft px-2.5 py-0.5 text-xs font-medium text-info">
      {archetypeLabel(archetype)}
    </span>
  );
}

export function ScoreBadge({
  score,
  size = "sm",
}: {
  score: number;
  size?: "sm" | "lg";
}) {
  const band = getBand(score);
  const big = size === "lg";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${band.bgClass} ${band.textClass} font-semibold ${
        big ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-0.5 text-xs"
      }`}
      title={`Real-PM score ${score}/100 — ${band.label}`}
    >
      <span className={big ? "text-base font-bold" : "font-bold"}>{score}</span>
      <span className="opacity-80">·</span>
      <span>{band.label}</span>
    </span>
  );
}

// Stage 7 — "Referral available" badge for admin-posted referral roles.
export function ReferralBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
      <UserCheck className="h-3.5 w-3.5" aria-hidden />
      Referral available
    </span>
  );
}

function freshnessIcon(state: FreshnessMeta["state"]) {
  switch (state) {
    case "fresh":
      return CheckCircle2;
    case "stale":
      return Clock;
    case "closed":
      return ShieldX;
    default:
      return HelpCircle;
  }
}

export function FreshnessFlag({
  isLive,
  checkedAt,
}: {
  isLive: boolean;
  checkedAt: string | null;
}) {
  const f = getFreshness(isLive, checkedAt);
  const Icon = freshnessIcon(f.state);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ${f.bgClass} ${f.textClass} px-2.5 py-0.5 text-xs font-medium`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {f.label}
    </span>
  );
}

// --- Stage 2.5 personalisation badges ---------------------------------------

const FIT_META = {
  strong: { label: "Strong fit", cls: "bg-success-soft text-success" },
  good: { label: "Good fit", cls: "bg-accent-soft text-accent" },
  partial: { label: "Partial fit", cls: "bg-surface-alt text-muted" },
} as const;

export function FitTag({ fit }: { fit: "strong" | "good" | "partial" }) {
  const m = FIT_META[fit];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

// e.g. "B2C · Mumbai · genuine PM"
export function ReasonChip({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
      {reasons.join(" · ")}
    </span>
  );
}

export { AlertTriangle };
