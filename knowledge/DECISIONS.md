# Decision Log — Product Compass

> One line per major architectural choice. Newest at top. Format: date · decision · why.

- 2026-06-28 · Live positioning reuses the SAME `buildPositioningPrompt` + `parseBrief` as the manual path (route sends `{role, profile}`, assembles + parses server-side) · one prompt + one parser = live and manual briefs are identical-shaped; less to keep in sync.
- 2026-06-28 · Budget guard = per-process module counter (default 15, `POSITION_CALL_CAP`) + `claude-haiku-4-5` + `max_tokens 1024`; validation 400s don't increment · cheap + bounded; resets on cold start (a dev guard, not a per-user quota — plumb `compass_uid` later if needed).
- 2026-06-28 · Fit read is pure-JS theme bucketing (JD keyword themes ∩ experience → % match + framable gaps), NOT an AI call · must be free/instant and available the moment experience is filled, before any brief.
- 2026-06-28 · Stage 3 briefs persist per role in localStorage (`compass_brief:<roleId>`), experience in `compass_experience` · no DB needed for v1 positioning; matches the no-auth `compass_uid` model.
- 2026-06-28 · Personalisation (Stage 2.5) is SSR-first: `prefs` starts null so server + first client render show browse mode, then localStorage loads and the list re-ranks · keeps roles server-rendered + avoids hydration mismatch; brief re-rank flash for returning users is acceptable.
- 2026-06-28 · Match score is pure JS (no AI): archetype 50 (dominant) + location 20 + real_pm_score 0–30 + small freshness boost; disguised roles (<40) capped at "partial" fit · scoring must be free/instant, and a disguised role must never be sold as a top match (product thesis).
- 2026-06-28 · Seed data = single source `scripts/roles-data.mjs` → `gen-seed-sql.mjs` emits `seed.sql`, run in Supabase SQL editor; `roles` gets a public SELECT-only RLS policy · anon can read shared roles, but writes/seeding stay service-role only.
- 2026-06-27 · Tailwind **v4** (default from create-next-app); Warm Clay tokens live in CSS `@theme` in `globals.css`, NOT a `tailwind.config.ts` · v4 is CSS-first — no JS config file is generated.
- 2026-06-27 · `src/` directory layout · CLAUDE.md references `src/config.ts`; keeps app code under one root.
- 2026-06-27 · No auth in v1; anonymous `compass_uid` (UUID in localStorage) as `owner_key` · ship faster, no login friction; add auth + RLS in v2.
- 2026-06-27 · Positioning runs server-side in `app/api/position/route.ts` · keep Anthropic key off the client.
- 2026-06-27 · Build manual paste-in fallback before live AI call · core flow must work with zero credits (€5 budget).
- 2026-06-27 · Models: `claude-haiku-4-5` for dev/validate, `claude-sonnet-4-6` for demo · cost control.
