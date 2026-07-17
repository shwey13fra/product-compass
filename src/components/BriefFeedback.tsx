"use client";

import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2, Check } from "lucide-react";
import { getCompassUid } from "@/lib/compass-uid";
import { track } from "@/lib/analytics";
import {
  rateBrief,
  getBriefFeedback,
  resolveBriefMode,
  NOTE_MAX,
  type BriefRating,
} from "@/lib/briefFeedback";

// Stage 13 — "was this brief any good?", inline under the rendered brief.
// Tertiary by design: this view's single terracotta primary is "Position me".
// Every failure is swallowed into a muted line — feedback must NEVER block the
// brief itself.
export function BriefFeedback({
  roleId,
  mode,
}: {
  roleId: string;
  mode: "live" | "manual" | undefined;
}) {
  const [rating, setRating] = useState<BriefRating | null>(null);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Item 4: a rated brief shows its rating on revisit. The DB is the source of
  // truth (not a localStorage mirror) because /admin/quality reads the same rows
  // and a mirror would drift from what the admin sees.
  useEffect(() => {
    let cancelled = false;
    const uid = getCompassUid();
    if (!uid) return;
    getBriefFeedback(uid, roleId).then((res) => {
      if (cancelled || !res.ok || !res.data) return;
      setRating(res.data.rating);
      setNote(res.data.note ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  async function submit(next: BriefRating, withNote: string | null) {
    const uid = getCompassUid();
    if (!uid) return;
    setBusy(true);
    setError(null);
    const res = await rateBrief(uid, roleId, resolveBriefMode(mode), next, withNote);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRating(next);
    setSaved(true);
    track("brief_rated", { role_id: roleId, mode: resolveBriefMode(mode), rating: next });
  }

  function onThumb(next: BriefRating) {
    setSaved(false);
    if (next === "thumbs_down") {
      setShowNote(true);
      submit(next, note.trim() || null);
      return;
    }
    setShowNote(false);
    setNote("");
    submit(next, null);
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-medium text-muted">Was this useful?</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onThumb("thumbs_up")}
            disabled={busy}
            aria-pressed={rating === "thumbs_up"}
            aria-label="This brief was useful"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-btn border transition-colors disabled:opacity-60 ${
              rating === "thumbs_up"
                ? "border-success/40 bg-success-soft text-success"
                : "border-border bg-surface text-muted hover:border-success/40 hover:text-success"
            }`}
          >
            <ThumbsUp className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onThumb("thumbs_down")}
            disabled={busy}
            aria-pressed={rating === "thumbs_down"}
            aria-label="This brief missed the mark"
            className={`inline-flex h-11 w-11 items-center justify-center rounded-btn border transition-colors disabled:opacity-60 ${
              rating === "thumbs_down"
                ? "border-danger/40 bg-danger-soft text-danger"
                : "border-border bg-surface text-muted hover:border-danger/40 hover:text-danger"
            }`}
          >
            <ThumbsDown className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-hidden />}
        {saved && !busy && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Thanks
          </span>
        )}
        {error && <span className="text-xs font-medium text-danger">{error}</span>}
      </div>

      {(showNote || rating === "thumbs_down") && (
        <div className="mt-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => rating === "thumbs_down" && submit("thumbs_down", note.trim() || null)}
            maxLength={NOTE_MAX}
            placeholder="What was off? (optional)"
            aria-label="What was off about this brief?"
            className="min-h-[44px] w-full max-w-md rounded-btn border border-border bg-bg px-3 text-sm text-ink outline-none focus:border-primary"
          />
        </div>
      )}
    </div>
  );
}
