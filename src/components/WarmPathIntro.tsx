"use client";

import { useState } from "react";
import { Users, Copy, Check, Clock, Pencil } from "lucide-react";
import Link from "next/link";
import type { Role } from "@/lib/types";
import type { ExperienceProfile } from "@/lib/experience";

// Stage 5 — warm/cold path hint shown on each Tracking card.
//  • Warm path → "Ask for an intro" + a pre-drafted template message (NO AI).
//  • Cold path → crowd response stat + "follow up by day X or move on".
// The intro uses the saved experience (compass_experience) for personalisation.

export function WarmPathIntro({
  role,
  profile,
}: {
  role: Role;
  profile: ExperienceProfile | null;
}) {
  if (role.has_warm_path) {
    return <WarmPath role={role} profile={profile} />;
  }
  return <ColdPath role={role} />;
}

function buildIntro(role: Role, profile: ExperienceProfile | null): string {
  const who = profile?.headline?.trim() || "a PM";
  const signoff = profile?.name?.trim() || "";
  const lines = [
    `Hi there, I saw ${role.company} is hiring a ${role.title}.`,
    `I'm ${who} and it looks like a strong fit — would you be open to a quick intro to the team? Happy to share more.`,
    signoff ? `Thanks,\n${signoff}` : "Thanks!",
  ];
  return lines.join("\n\n");
}

function WarmPath({
  role,
  profile,
}: {
  role: Role;
  profile: ExperienceProfile | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasExperience = !!profile?.headline?.trim() || !!profile?.name?.trim();
  const intro = buildIntro(role, profile);

  async function copy() {
    try {
      await navigator.clipboard.writeText(intro);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = intro;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="rounded-card border border-success/30 bg-success-soft/40 p-4">
      <h4 className="inline-flex items-center gap-2 font-heading text-sm font-bold text-ink">
        <Users className="h-4 w-4 text-success" aria-hidden />
        Warm path — ask for an intro
      </h4>
      <p className="mt-1.5 text-sm text-muted">
        {role.warm_path_note ?? "A referral route exists for this role."}
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-success px-4 text-sm font-semibold text-white shadow-[var(--shadow-warm)] transition-colors hover:brightness-95"
        >
          <Users className="h-4 w-4" aria-hidden />
          Draft an intro request
        </button>
      ) : (
        <div className="mt-3">
          {!hasExperience && (
            <p className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              <span>
                Add your experience on a{" "}
                <Link href={`/roles/${role.id}`} className="font-semibold text-primary underline">
                  role page
                </Link>{" "}
                to personalise this.
              </span>
            </p>
          )}
          <div className="rounded-btn border border-border bg-surface p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{intro}</p>
          </div>
          <button
            type="button"
            onClick={copy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-btn border border-border bg-surface px-3 py-2 text-xs font-semibold text-ink transition-colors hover:border-success hover:text-success"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-success" aria-hidden />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Copy intro
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function ColdPath({ role }: { role: Role }) {
  const days = role.crowd_response_days;
  return (
    <div className="rounded-card border border-border bg-surface-alt p-4">
      <h4 className="inline-flex items-center gap-2 font-heading text-sm font-bold text-ink">
        <Clock className="h-4 w-4 text-info" aria-hidden />
        Cold path
      </h4>
      {days != null ? (
        <p className="mt-1.5 text-sm text-muted">
          Members typically hear back in about{" "}
          <span className="font-semibold text-ink">
            {days} {days === 1 ? "day" : "days"}
          </span>
          . Follow up by{" "}
          <span className="font-semibold text-ink">day {days}</span> or move on.
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-muted">
          No warm path for this role and no crowd data yet — give it a week, then
          follow up or move on.
        </p>
      )}
    </div>
  );
}
