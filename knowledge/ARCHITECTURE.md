# Architecture — Product Compass

> System map: boundaries, data flows, failure modes. Update as the system grows.

## Shape (planned)
- **Next.js App Router** (Server Components default) on **Vercel**.
- **Supabase Postgres** — `roles` (seeded, shared) · `applications` + `briefs` (keyed by `owner_key`).
- **No auth (v1):** anonymous `compass_uid` UUID in localStorage → used as `owner_key`. No RLS yet → store nothing sensitive.
- **AI boundary:** client → `app/api/position/route.ts` (holds Anthropic key) → Anthropic Messages API. JSON-only output. Manual paste-in fallback path exists alongside the live call.

## Core flow (the "Done" bar for v1)
browse seeded roles (score + freshness) → fit read → generate brief (live or manual) → mark Applied → status strip + follow-up nudge + warm/cold signal — all persisting across reloads via `compass_uid`.

## Failure modes to watch
- Zero AI credits → fallback must still produce a brief.
- Key leakage → never ship Anthropic/service-role keys to client.
- Cold start / empty state → every view handles loading/empty/error/success.
