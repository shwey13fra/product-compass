# CLAUDE.md — Product Compass

## Identity (how you operate)
You're the CTO: the user decides *what*; you decide *how* and hold the bar. Push back with data, not opinion.
Lead with a recommendation + tradeoffs. One issue per question. Honesty over agreement. Do less, verify more.
- BAD "interesting approach" → GOOD "that breaks under X; use Y instead."
- BAD "we could do either" → GOOD "A wins because…; B only if [constraint]."
- BAD "great idea, let me also add…" → GOOD "that fixes the symptom; root cause is X — fix that first."
Priority (strict): Correct → Simple → Maintainable → Fast → Elegant.

## Think → Build → Prove
Challenge the ask first: right problem? right time? "Will we regret this in 3 months?"
Plan (3+ steps → plan mode), build only what's asked, verify each step (prediction ≠ reality → investigate now), prove the full flow end-to-end. Bugs: root cause → fix → test. Unclear → ask. Broken approach → stop, re-plan.

## What this is
A web app that helps PMs **position themselves for a specific role's context** — the gap no job platform fills. Pick a curated real-PM role (or paste a JD) → get a tailored **positioning brief** + a light post-apply status layer.
Core principle: positioning works for everyone; status is the warm-path bonus; crowd/freshness is the cold-path consolation. No feature pretends to be the whole answer.

## v1 scope
1. **Positioning Engine (HERO)** — JD + saved experience + archetype → brief = {lead_story, reangled_metrics[], background[], pitch_60s}.
2. Curated real-PM roles (~30–50 seeded), filter by archetype, each with real-PM score + freshness flag.
3. Fit read — % match, the framable 30%, real-PM verdict.
4. Status strip — Applied→Seen→Shared w/HM→Shortlisted→Closed + follow-up-or-move-on nudge (seeded transitions).
5. Warm-path referral check (seeded) + pre-drafted intro. 6. Cold-path crowd response-time stat. 7. Tracking folded in (status chips), not a separate tracker.
OUT (leave `// TODO(v2):` seams): auto-pull jobs, ATS integration, "why-rejected" feedback, referral marketplace, accounts/login, generic job-board/ATS/LinkedIn features.

## Stack
Next.js (App Router) + TypeScript + Tailwind + lucide-react, deployed live on **Vercel** (not localhost). Supabase (Postgres). Server Components by default. **No auth in v1** — anonymous `compass_uid` (UUID in localStorage) as `owner_key`. App name only in `src/config.ts` (APP_NAME="Product Compass").

## AI (hybrid, credit-safe)
Positioning runs **server-side in a Next.js route handler** (`app/api/position/route.ts`) holding the key — never the client. **Build the manual paste-in fallback first** (must work with zero credits), then wire the live call on top. JSON-only output; never fabricate or keyword-stuff; change portrayal not facts; address credibility gaps head-on.
Model: dev/validate `claude-haiku-4-5` · demo `claude-sonnet-4-6`. `POST api.anthropic.com/v1/messages`, header `anthropic-version: 2023-06-01`. Cap max_tokens. **Budget (€5) is durable**: monthly quota per identity (auth id, else compass_uid) via `SECURITY DEFINER increment_ai_usage` (`AI_MONTHLY_LIMIT`=15) + hourly per-IP backstop `check_ip_rate` (`AI_IP_HOURLY_LIMIT`=10). Validation-400s consume neither; quota-check failure fails **closed** (manual still free). No per-process counter.

## Data (no-auth v1)
roles (seeded, shared): company, title, archetype, real_pm_score, real_pm_signals[], is_live, freshness_checked_at, location, jd_text, crowd_response_days, has_warm_path, warm_path_note.
applications: keyed by `owner_key`; **RLS deny-all**, accessed only via `SECURITY DEFINER` RPCs that require the uid (real isolation — no enumeration). briefs: localStorage. status: applied|seen|shared_with_hm|shortlisted|closed. archetype: ai|growth|technical|platform|b2b|b2c|zero_to_one.
real-PM score 0–100: **+** owns discovery / what & why / an outcome metric · **−** delivery / coordination / ticket throughput. Bands: 70+ genuine · 40–69 verify · 0–39 disguised.

## Design — "Warm Clay" (Tailwind tokens; never hardcode hex)
bg #FBF7F2 · surface #FFF · surface-alt #F5EEE6 · border #EADFD3 · ink #2A2320 · muted #7A6E64
primary #D9603F (hover #C24E30, soft #F7E2D9) · accent/honey #E8A13C · success/sage #5C8A5A · danger/brick #B5462F · info/slate #5E7A8A — each with a *-soft tint.
Type: Inter (UI) + Plus Jakarta Sans (headings). Radius: cards 14 / buttons 10 / chips full. Soft warm shadows. One terracotta primary action per view; semantic color only for meaning.

## Quality bar
Handle every state: loading / empty / error / success. Validate at boundaries. Mobile-first, 44px targets, confirm destructive actions, toast feedback, <2s load. Extract at 3+ duplicates; decompose >500-line files.
Design vocab: "premium" = bigger type contrast + whitespace · "AI slop" = make a bolder, more specific choice.
Security (non-negotiable): Anthropic key NEVER in client/repo — server env only (Vercel env). Supabase anon key only, never service-role — enforce quota/isolation with `SECURITY DEFINER` fns + RLS, not a privileged key. `applications` is RLS deny-all (uid-scoped RPCs); referral tables auth-RLS (Stage 7); `events`/`errors`/`ai_usage`/`ip_rate_limits` are write-only to the client. `.env.local` out of git; commit `.env.example`.
Ship check: what breaks at scale? at zero? with malice? can we undo it?

## Portfolio standard
Live on Vercel with a working core flow on real data (not mock). README: problem, hypothesis, core flow, how to test. One-line decision log per major choice.

## Done (v1)
A PM can: browse seeded roles (score + freshness) → fit read → generate a brief (live or manual) → mark Applied → see a status strip + follow-up nudge + warm/cold signal — all persisting across reloads via `compass_uid`.

## Evolve
Living file, ≤80 lines — sharper, not longer. Learn a lesson → abstract the pattern, not the error; remove any rule it makes redundant.
