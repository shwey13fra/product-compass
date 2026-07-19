import { CheckCircle2, AlertTriangle, ShieldX, Clock, HelpCircle, UserCheck, FlaskConical } from "lucide-react";
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

// Stage 8 — provenance badge. 'seed' = illustrative sample data (deletable);
// greenhouse/lever/adzuna = ingested from a live source.
const SOURCE_META: Record<string, { label: string; cls: string }> = {
  seed: { label: "Sample", cls: "bg-surface-alt text-muted" },
  greenhouse: { label: "Greenhouse", cls: "bg-info-soft text-info" },
  lever: { label: "Lever", cls: "bg-info-soft text-info" },
  adzuna: { label: "Adzuna", cls: "bg-info-soft text-info" },
};

export function SourceBadge({ source }: { source: string | null }) {
  // Stage 17.5 — sample (seed) roles get an UNMISSABLE badge, not the muted chip:
  // honey tint + flask icon + ring + tooltip, so no one mistakes an illustrative
  // role for a live opening.
  if (source === "seed") return <SampleBadge />;
  const m = source ? SOURCE_META[source] : null;
  if (!m) return null;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

export function SampleBadge() {
  return (
    <span
      title="Illustrative role — not a live opening."
      aria-label="Sample role — illustrative, not a live opening"
      className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-accent ring-1 ring-accent/40"
    >
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      Sample
    </span>
  );
}

// Stage 17.5 — full-width callout for the detail page. Renders only for samples.
export function SampleNotice({ source }: { source: string | null }) {
  if (source !== "seed") return null;
  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-card border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-ink">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <p>
        <span className="font-semibold">Illustrative sample role — not a live opening.</span>{" "}
        It&apos;s here to show how Product Compass works. Try positioning against it,
        but don&apos;t apply expecting a reply.
      </p>
    </div>
  );
}

export function sourceLabel(source: string | null): string {
  return source && SOURCE_META[source] ? SOURCE_META[source].label : "site";
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
