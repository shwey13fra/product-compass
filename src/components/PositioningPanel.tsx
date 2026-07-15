"use client";

import { useEffect, useRef, useState } from "react";
import {
  Compass,
  Pencil,
  Copy,
  Check,
  Sparkles,
  Wand2,
  Star,
  TrendingUp,
  EyeOff,
  Mic,
  Target,
  RotateCcw,
  Loader2,
  AlertTriangle,
  ClipboardPaste,
  ArrowLeft,
} from "lucide-react";
import type { Role } from "@/lib/types";
import { archetypeLabel } from "@/lib/types";
import {
  loadExperience,
  saveExperience,
  isExperienceReady,
  type ExperienceProfile,
} from "@/lib/experience";
import {
  buildPositioningPrompt,
  parseBrief,
  computeFitRead,
  loadBrief,
  saveBrief,
  type Brief,
  type FitRead,
  type StoredBrief,
} from "@/lib/positioning";
import { ExperienceForm } from "@/components/ExperienceForm";
import { track } from "@/lib/analytics";
import { getCompassUid } from "@/lib/compass-uid";
import { supabase } from "@/lib/supabase";

// Stage 4 (LIVE + MANUAL): set up experience → "Position me" calls the
// server-side route (which holds the Anthropic key) and auto-fills the brief.
// The manual copy-prompt / paste-JSON path from Stage 3 stays as a zero-credit
// fallback. Everything persists in localStorage so a brief survives reloads.

export function PositioningPanel({ role }: { role: Role }) {
  const [mounted, setMounted] = useState(false);
  const [profile, setProfile] = useState<ExperienceProfile | null>(null);
  const [editing, setEditing] = useState(false);

  const [prompt, setPrompt] = useState<string | null>(null); // manual mode active
  const [paste, setPaste] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredBrief | null>(null);

  // Live-call state.
  const [loading, setLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [callsRemaining, setCallsRemaining] = useState<number | null>(null);
  const [reposing, setReposing] = useState(false); // re-open the action chooser

  // Load persisted state on mount (localStorage is client-only).
  useEffect(() => {
    const p = loadExperience();
    setProfile(p);
    setStored(loadBrief(role.id));
    if (!isExperienceReady(p)) setEditing(true);
    setMounted(true);
  }, [role.id]);

  function handleSaveExperience(p: ExperienceProfile) {
    saveExperience(p);
    setProfile(p);
    setEditing(false);
  }

  // LIVE: call the server route, which holds the key and returns a parsed brief.
  async function handlePositionLive() {
    if (!isExperienceReady(profile)) return;
    setLoading(true);
    setLiveError(null);
    try {
      // Identity for the durable monthly quota: compass_uid always; the auth
      // token too if signed in (the server prefers the verified user id).
      const headers: Record<string, string> = { "content-type": "application/json" };
      const uid = getCompassUid();
      if (uid) headers["x-compass-uid"] = uid;
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch("/api/position", {
        method: "POST",
        headers,
        body: JSON.stringify({ role, profile }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        brief?: Brief;
        error?: string;
        callsRemaining?: number;
      };
      if (typeof data.callsRemaining === "number") setCallsRemaining(data.callsRemaining);
      if (!data.ok || !data.brief) {
        setLiveError(data.error ?? "Positioning failed. Try the manual paste-in.");
        return;
      }
      const fit = computeFitRead(role, profile);
      const raw = JSON.stringify(data.brief, null, 2);
      const s = saveBrief(role.id, data.brief, fit, raw);
      setStored(s);
      setReposing(false);
      setPrompt(null);
      track("brief_generated", { mode: "live", role_id: role.id });
    } catch {
      setLiveError("Network error reaching the model. Try again or paste in manually.");
    } finally {
      setLoading(false);
    }
  }

  // MANUAL: assemble the prompt to copy into Claude, then paste the JSON back.
  function handleManual() {
    if (!isExperienceReady(profile)) return;
    setPrompt(buildPositioningPrompt(role, profile));
    setPaste(stored?.rawJson ?? "");
    setParseError(null);
    setLiveError(null);
  }

  function handleShowBrief() {
    const result = parseBrief(paste);
    if (!result.ok) {
      setParseError(result.error);
      return;
    }
    if (!profile) return;
    const fit = computeFitRead(role, profile);
    const s = saveBrief(role.id, result.brief, fit, paste);
    setStored(s);
    setParseError(null);
    setPrompt(null);
    setPaste("");
    setReposing(false);
    track("brief_generated", { mode: "manual", role_id: role.id });
  }

  function handleReposition() {
    setReposing(true);
    setLiveError(null);
    setPrompt(null);
  }

  const ready = isExperienceReady(profile);
  // Fit read is derived purely from JD vs experience — show it as soon as we can.
  const fit: FitRead | null = ready && profile ? computeFitRead(role, profile) : null;

  // Fire fit_read_shown once, when the fit read first becomes visible for this role.
  const fitTracked = useRef(false);
  useEffect(() => {
    if (fit && !fitTracked.current) {
      fitTracked.current = true;
      track("fit_read_shown", { role_id: role.id });
    }
  }, [fit, role.id]);
  // Show the action chooser when there's no saved brief yet, or the user asked
  // to re-position — but not while the manual prompt or a live call is active.
  const showActions = !prompt && !loading && (!stored || reposing);

  return (
    <section className="mt-4 rounded-card border border-primary/30 bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
      <header className="flex items-center gap-2">
        <Compass className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="font-heading text-base font-bold text-ink">
          Position me for this role
        </h2>
      </header>

      {!mounted ? (
        <div className="mt-4 h-24 animate-pulse rounded-card bg-surface-alt" aria-hidden />
      ) : editing ? (
        <div className="mt-4">
          <p className="mb-4 text-sm text-muted">
            Fill this once — it&apos;s saved on this device and reused for every role.
          </p>
          <ExperienceForm
            initial={profile}
            onSave={handleSaveExperience}
            onCancel={ready ? () => setEditing(false) : undefined}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          <ExperienceSummary
            profile={profile!}
            onEdit={() => setEditing(true)}
          />

          {fit && <FitReadView fit={fit} role={role} />}

          {/* Saved brief, if any */}
          {stored && <BriefView stored={stored} onReposition={handleReposition} />}

          {/* Live call in progress */}
          {loading && (
            <div className="flex items-center gap-2.5 rounded-card border border-border bg-surface-alt p-4 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
              Positioning you for this role…
            </div>
          )}

          {/* Action chooser: live (default) or manual fallback */}
          {showActions && (
            <PositionActions
              isRepose={!!stored}
              liveError={liveError}
              callsRemaining={callsRemaining}
              onLive={handlePositionLive}
              onManual={handleManual}
            />
          )}

          {/* Manual prompt + paste-back workflow (Stage 3 fallback) */}
          {prompt && (
            <PromptWorkflow
              prompt={prompt}
              paste={paste}
              setPaste={setPaste}
              parseError={parseError}
              onShowBrief={handleShowBrief}
              onCancel={() => {
                setPrompt(null);
                setParseError(null);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

// --- Experience summary ------------------------------------------------------

function ExperienceSummary({
  profile,
  onEdit,
}: {
  profile: ExperienceProfile;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-card border border-border bg-surface-alt p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            My experience
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-ink">
            {profile.name || "Unnamed PM"}
            {profile.headline && (
              <span className="font-normal text-muted"> · {profile.headline}</span>
            )}
          </p>
          {profile.archetype && (
            <p className="mt-0.5 text-xs text-muted">
              Aiming for {archetypeLabel(profile.archetype)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-btn px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface hover:text-primary"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Edit
        </button>
      </div>
    </div>
  );
}

// --- Fit read ----------------------------------------------------------------

// Static class maps — Tailwind can't generate classes from interpolated strings.
const FIT_TONE = {
  success: { badge: "bg-success-soft text-success", bar: "bg-success" },
  accent: { badge: "bg-accent-soft text-accent", bar: "bg-accent" },
  danger: { badge: "bg-danger-soft text-danger", bar: "bg-danger" },
} as const;

function FitReadView({ fit, role }: { fit: FitRead; role: Role }) {
  const toneKey: keyof typeof FIT_TONE =
    fit.matchPct >= 70 ? "success" : fit.matchPct >= 45 ? "accent" : "danger";
  const tone = FIT_TONE[toneKey];
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 font-heading text-sm font-bold text-ink">
          <Target className="h-4 w-4 text-muted" aria-hidden />
          Fit read
        </h3>
        <span
          className={`inline-flex items-baseline gap-1 rounded-full px-3 py-1 ${tone.badge}`}
        >
          <span className="text-base font-bold">{fit.matchPct}%</span>
          <span className="text-xs font-medium">rough match</span>
        </span>
      </div>

      {/* match bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-alt">
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: `${fit.matchPct}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-muted">
        Rough read from your experience vs the {archetypeLabel(role.archetype)}{" "}
        JD{fit.archetypeAligned ? " · archetype aligned" : ""}.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-success">
            You already cover
          </p>
          {fit.covered.length ? (
            <ul className="mt-1.5 space-y-1">
              {fit.covered.map((c) => (
                <li key={c} className="flex items-start gap-1.5 text-sm text-ink">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-muted">Nothing detected yet.</p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">
            The framable 30% — not yet covered
          </p>
          {fit.framable.length ? (
            <ul className="mt-1.5 space-y-1">
              {fit.framable.map((c) => (
                <li key={c} className="flex items-start gap-1.5 text-sm text-ink">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  {c}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-muted">
              You cover the JD&apos;s main themes — frame for depth, not breadth.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Prompt workflow (copy out, paste back) ---------------------------------

// --- Action chooser: live (default) vs manual fallback ----------------------

function PositionActions({
  isRepose,
  liveError,
  callsRemaining,
  onLive,
  onManual,
}: {
  isRepose: boolean;
  liveError: string | null;
  callsRemaining: number | null;
  onLive: () => void;
  onManual: () => void;
}) {
  const lowOnCalls = callsRemaining != null && callsRemaining <= 3;
  return (
    <div className="space-y-3">
      {liveError && (
        <div className="flex items-start gap-2 rounded-card border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{liveError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onLive}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white shadow-[var(--shadow-warm)] transition-colors hover:bg-primary-hover"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {isRepose ? "Re-run positioning" : "Position me"}
        </button>
        <button
          type="button"
          onClick={onManual}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-btn px-3 text-sm font-medium text-muted transition-colors hover:text-primary"
        >
          <ClipboardPaste className="h-4 w-4" aria-hidden />
          Paste it in manually
        </button>
      </div>

      {lowOnCalls && (
        <p className="text-xs font-medium text-accent">
          {callsRemaining === 0
            ? "Live positioning is used up this month — use the manual paste-in."
            : `${callsRemaining} live ${callsRemaining === 1 ? "run" : "runs"} left this month.`}
        </p>
      )}
      <p className="text-xs text-muted">
        Live runs Claude server-side (your key never touches the browser). Manual
        paste-in works with zero credits.
      </p>
    </div>
  );
}

function PromptWorkflow({
  prompt,
  paste,
  setPaste,
  parseError,
  onShowBrief,
  onCancel,
}: {
  prompt: string;
  paste: string;
  setPaste: (v: string) => void;
  parseError: string | null;
  onShowBrief: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to live positioning
      </button>

      {/* Step 1 — copy the prompt */}
      <div className="rounded-card border border-border bg-surface-alt p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
              1
            </span>
            Copy this prompt into Claude
          </p>
          <CopyButton text={prompt} />
        </div>
        <textarea
          readOnly
          value={prompt}
          rows={10}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-3 w-full resize-y rounded-btn border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-ink/90 outline-none"
        />
      </div>

      {/* Step 2 — paste the JSON back */}
      <div className="rounded-card border border-border bg-surface-alt p-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
            2
          </span>
          Paste the JSON result back here
        </p>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={7}
          placeholder='{ "lead_story": "...", "reangled_metrics": ["..."], "background": ["..."], "pitch_60s": "..." }'
          className={`mt-3 w-full resize-y rounded-btn border bg-surface p-3 font-mono text-xs leading-relaxed text-ink outline-none transition focus:ring-2 focus:ring-primary/20 ${
            parseError ? "border-danger/60" : "border-border focus:border-primary"
          }`}
        />
        {parseError && (
          <p className="mt-1.5 text-xs font-medium text-danger">{parseError}</p>
        )}
        <button
          type="button"
          onClick={onShowBrief}
          disabled={!paste.trim()}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-4 text-sm font-semibold text-white shadow-[var(--shadow-warm)] transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Wand2 className="h-4 w-4" aria-hidden />
          Show my brief
        </button>
      </div>
    </div>
  );
}

// --- Brief view (4 sections) ------------------------------------------------

function BriefView({
  stored,
  onReposition,
}: {
  stored: StoredBrief;
  onReposition: () => void;
}) {
  const { brief } = stored;
  // Plain-text rendering of the brief so a PM can paste it straight into an
  // application / notes. Powers the brief_copied event.
  const briefText = [
    brief.lead_story ? `LEAD STORY\n${brief.lead_story}` : "",
    brief.reangled_metrics.length
      ? `RE-ANGLED METRICS\n${brief.reangled_metrics.map((m) => `- ${m}`).join("\n")}`
      : "",
    brief.background.length
      ? `WHAT TO BACKGROUND\n${brief.background.map((m) => `- ${m}`).join("\n")}`
      : "",
    brief.pitch_60s ? `60-SECOND PITCH\n${brief.pitch_60s}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className="rounded-card border border-success/30 bg-success-soft/40 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 font-heading text-sm font-bold text-ink">
          <Check className="h-4 w-4 text-success" aria-hidden />
          Your positioning brief
        </h3>
        <div className="flex items-center gap-2">
          <CopyButton
            text={briefText}
            label="Copy brief"
            onCopied={() => track("brief_copied", { role_id: stored.roleId })}
          />
          <button
            type="button"
            onClick={onReposition}
            className="inline-flex items-center gap-1.5 rounded-btn px-2.5 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface hover:text-primary"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Re-position
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <BriefBlock icon={Star} title="Lead story">
          {brief.lead_story ? (
            <p className="text-sm leading-relaxed text-ink">{brief.lead_story}</p>
          ) : (
            <Empty />
          )}
        </BriefBlock>

        <BriefBlock icon={TrendingUp} title="Re-angled metrics">
          {brief.reangled_metrics.length ? (
            <ul className="space-y-1.5">
              {brief.reangled_metrics.map((m, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </BriefBlock>

        <BriefBlock icon={EyeOff} title="What to background">
          {brief.background.length ? (
            <ul className="space-y-1.5">
              {brief.background.map((m, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted" aria-hidden />
                  {m}
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </BriefBlock>

        <BriefBlock icon={Mic} title="60-second pitch">
          {brief.pitch_60s ? (
            <p className="rounded-btn border border-border bg-surface p-3 text-sm italic leading-relaxed text-ink">
              {brief.pitch_60s}
            </p>
          ) : (
            <Empty />
          )}
        </BriefBlock>
      </div>

      <p className="mt-4 text-xs text-muted">
        Saved on this device · {new Date(stored.savedAt).toLocaleString()}
      </p>
    </div>
  );
}

function BriefBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {title}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted">— not provided in the result —</p>;
}

// --- Copy button -------------------------------------------------------------

function CopyButton({
  text,
  label = "Copy",
  onCopied,
}: {
  text: string;
  label?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for older browsers / insecure contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-btn border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-primary hover:text-primary"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-success" aria-hidden />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {label}
        </>
      )}
    </button>
  );
}
