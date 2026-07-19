"use client";

import { ArrowUpRight } from "lucide-react";
import { track } from "@/lib/analytics";
import { loadBrief } from "@/lib/positioning";

// Stage 8 — ingested roles link OUT to the real posting (no fake apply).
// Stage 18 capture — fire `applied` on click-out. This is INTENT, not a confirmed
// submission (the user leaves for the external posting), flagged via via:"external"
// so the matching report can treat it accordingly.
export function ApplyOutButton({
  url,
  source,
  roleId,
  surface,
  rank,
}: {
  url: string;
  source: string;
  roleId: string;
  surface?: string;
  rank?: number;
}) {
  function onApply() {
    track("applied", {
      role_id: roleId,
      had_brief: loadBrief(roleId) !== null,
      surface: surface ?? "direct",
      ...(rank != null ? { rank } : {}),
      via: "external",
    });
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onApply}
      className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
    >
      Apply on {source}
      <ArrowUpRight className="h-4 w-4" aria-hidden />
    </a>
  );
}
