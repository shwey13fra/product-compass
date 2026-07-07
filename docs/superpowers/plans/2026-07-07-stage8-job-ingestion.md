# Stage 8 — Job Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest real PM roles from legal public sources (Greenhouse, Lever, Adzuna) into the existing `roles` table via an admin-triggered route, scored by a rule-based (no-AI) real-PM scorer.

**Architecture:** A `POST /api/ingest` route, gated to admins by forwarding the signed-in admin's Supabase JWT so writes pass the existing admin-only RLS on `roles` (no `service_role`). The route runs a pure-TS pipeline: fetch → filter PM titles → normalize → score → dedupe → upsert → expire stale. Ingested rows carry a `source` tag; the 50 existing sample rows are tagged `source='seed'` and badged "Sample" for later deletion.

**Tech Stack:** Next.js 16 (App Router, `src/`) · TypeScript · Supabase (Postgres, anon key only) · Tailwind v4 · lucide-react. Tests run via `tsx` against the TS source (no test runner exists in this repo).

## Global Constraints

- **Security:** Supabase **anon key only** — never `service_role`. Adzuna keys (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`) live in **server env only**, never `NEXT_PUBLIC_`. Anthropic key untouched — **no AI call anywhere in Stage 8**.
- **RLS:** `roles` writes are admin-only (`scripts/stage7-auth-referrals.sql`). The ingest route writes using the caller's forwarded JWT; it re-checks `isAdminEmail(user.email)` server-side before writing.
- **Design:** Warm Clay Tailwind tokens only — never hardcoded hex. Cards radius `rounded-card`, buttons `rounded-btn`, 44px min touch targets. One terracotta primary action per view.
- **Data:** `roles` NOT NULL columns include `real_pm_signals` and `crowd_response_days` — every ingested row must supply both (scorer array + default `14`).
- **Sources (verbatim):** Greenhouse `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`; Lever `https://api.lever.co/v0/postings/{company}?mode=json`; Adzuna `country=in`, `what="product manager"`. Do NOT scrape LinkedIn/Naukri.
- **Title filter:** keep product manager / senior PM / APM / group PM; **exclude** "project manager" and "program manager".
- **Commits:** end each commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Work on branch `main` (trunk-based, per Sessions 1–8).

---

### Task 1: Schema migration + extend `Role` type

**Files:**
- Create: `scripts/stage8-job-ingestion.sql`
- Modify: `src/lib/types.ts:13-30` (add 4 fields to `Role`)
- Modify: `src/lib/roles.ts:8-9` (`ROLE_COLUMNS`)

**Interfaces:**
- Produces: `Role` gains `source: string | null`, `external_id: string | null`, `apply_url: string | null`, `ingested_at: string | null`.

- [ ] **Step 1: Write the migration SQL**

Create `scripts/stage8-job-ingestion.sql`:

```sql
-- Stage 8 — job ingestion. Idempotent: safe to re-run.
-- Run in the Supabase SQL editor AFTER stage7-auth-referrals.sql.
-- Adds ingestion columns to roles; tags existing sample rows as source='seed'.
-- No new RLS: existing public-read + admin-write policies on roles cover
-- ingested rows (the ingest route writes with the admin's forwarded JWT).

alter table public.roles
  add column if not exists source       text,
  add column if not exists external_id  text,
  add column if not exists apply_url    text,
  add column if not exists ingested_at  timestamptz;

-- Tag the 50 illustrative sample rows so they are badged "Sample" now and
-- deletable later with:  delete from public.roles where source = 'seed';
update public.roles set source = 'seed' where source is null;

-- Dedupe/upsert key for ingested rows (seed rows have null external_id).
create unique index if not exists roles_source_external_id_uidx
  on public.roles (source, external_id)
  where external_id is not null;
```

- [ ] **Step 2: Extend the `Role` type**

In `src/lib/types.ts`, add to the `Role` type (after `referrer_email: string | null;`):

```ts
  // Stage 8 — ingestion provenance. 'seed' = illustrative sample data;
  // 'greenhouse'|'lever'|'adzuna' = ingested from a live source.
  source: string | null;
  external_id: string | null;
  apply_url: string | null;
  ingested_at: string | null;
```

- [ ] **Step 3: Extend `ROLE_COLUMNS`**

In `src/lib/roles.ts`, replace the `ROLE_COLUMNS` string (line 8-9) with:

```ts
const ROLE_COLUMNS =
  "id,company,title,archetype,real_pm_score,real_pm_signals,is_live,freshness_checked_at,location,jd_text,crowd_response_days,has_warm_path,warm_path_note,is_referral,referrer_email,source,external_id,apply_url,ingested_at";
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add scripts/stage8-job-ingestion.sql src/lib/types.ts src/lib/roles.ts
git commit -m "feat(stage8): add ingestion columns to roles + Role type

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **NOTE for the human:** run `scripts/stage8-job-ingestion.sql` in the Supabase SQL editor before the first live sync (Task 11). The app keeps working before that — the new columns just read as null.

---

### Task 2: Rule-based real-PM scorer + archetype inference

**Files:**
- Create: `src/lib/realPmScore.ts`
- Create: `scripts/tests/realPmScore.test.ts`
- Modify: `package.json` (add `tsx` devDependency)

**Interfaces:**
- Produces: `scoreRealPm(title: string, jd: string): { score: number; signals: string[] }`; `inferArchetype(title: string, jd: string): Archetype`.

- [ ] **Step 1: Add the `tsx` test runner**

Run: `npm install -D tsx`
Expected: `tsx` appears in `devDependencies`.

- [ ] **Step 2: Write the failing test**

Create `scripts/tests/realPmScore.test.ts`:

```ts
import assert from "node:assert/strict";
import { scoreRealPm, inferArchetype } from "@/lib/realPmScore";

// A genuine, discovery-and-outcome-owning JD should land in the "genuine" band.
const genuine = scoreRealPm(
  "Senior Product Manager, Discovery",
  "Own the discovery and roadmap for search. Define what to build and why from user research, run experiments, and own activation and retention as your north star metric."
);
assert.ok(genuine.score >= 70, `expected genuine >= 70, got ${genuine.score}`);
assert.ok(genuine.signals.length > 0, "genuine should have signals");

// A delivery/coordination JD should land in the "disguised" band.
const disguised = scoreRealPm(
  "Product Manager (Delivery)",
  "Coordinate delivery across squads. Gather requirements from stakeholders, manage timelines and release governance, and drive sprint ticket throughput."
);
assert.ok(disguised.score < 40, `expected disguised < 40, got ${disguised.score}`);

// Never returns an empty signals array (UI would show "No signals").
const thin = scoreRealPm("Product Manager", "");
assert.ok(thin.signals.length > 0, "thin JD still returns a signal");

// Archetype inference.
assert.equal(inferArchetype("PM, LLM Products", "Own LLM eval and model quality."), "ai");
assert.equal(inferArchetype("Growth PM", "Own acquisition and activation funnels."), "growth");
assert.equal(inferArchetype("Product Manager", "Consumer mobile app."), "b2c");

console.log("realPmScore: all assertions passed");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx scripts/tests/realPmScore.test.ts`
Expected: FAIL — cannot find module `@/lib/realPmScore`.

- [ ] **Step 4: Write the scorer**

Create `src/lib/realPmScore.ts`:

```ts
// Stage 8 — rule-based real-PM scorer. Pure JS, NO AI calls (protects credits).
// Mirrors CLAUDE.md's rubric: + owns discovery / what & why / an outcome metric
// · − delivery / coordination / ticket throughput. Bands via getBand(): 70+
// genuine · 40–69 verify · <40 disguised. Rougher than the hand-authored seed
// scores — the "Sourced" badge keeps that honest.

import type { Archetype } from "@/lib/types";

type SignalGroup = { weight: number; label: string; keywords: string[] };

const POSITIVE: SignalGroup[] = [
  {
    weight: 22,
    label: "owns discovery & user research",
    keywords: ["discovery", "user research", "customer interview", "user needs", "problem space", "jobs to be done", "user insight"],
  },
  {
    weight: 22,
    label: "decides what to build and why",
    keywords: ["define the roadmap", "own the roadmap", "product strategy", "what to build", "product vision", "prioriti", "set the direction", "shape the roadmap"],
  },
  {
    weight: 20,
    label: "owns an outcome metric",
    keywords: ["north star", "outcome metric", "own the metric", "activation", "retention", "conversion", "engagement metric", "business outcome", "own kpi"],
  },
];

const NEGATIVE: SignalGroup[] = [
  {
    weight: 18,
    label: "delivery & coordination focus",
    keywords: ["coordinate delivery", "cross-team coordination", "stakeholder management", "delivery-focused", "execution-focused", "coordinate across"],
  },
  {
    weight: 18,
    label: "ticket / throughput focus",
    keywords: ["ticket", "backlog grooming", "sprint management", "story points", "throughput", "jira"],
  },
  {
    weight: 16,
    label: "requirements & timelines, not what/why",
    keywords: ["gather requirements", "requirements gathering", "manage timelines", "release governance", "release management", "project plan", "on time and on budget"],
  },
];

export type RealPmResult = { score: number; signals: string[] };

export function scoreRealPm(title: string, jd: string): RealPmResult {
  const text = `${title}\n${jd}`.toLowerCase();
  let score = 50; // neutral base
  const signals: string[] = [];

  for (const g of POSITIVE) {
    if (g.keywords.some((k) => text.includes(k))) {
      score += g.weight;
      signals.push(g.label);
    }
  }
  for (const g of NEGATIVE) {
    if (g.keywords.some((k) => text.includes(k))) {
      score -= g.weight;
      signals.push(g.label);
    }
  }

  score = Math.max(0, Math.min(100, score));
  if (signals.length === 0) signals.push("limited signal in the description");
  return { score, signals };
}

// Best-effort archetype from title + JD keywords. Order matters (most specific
// first); defaults to b2c when nothing matches.
const ARCHETYPE_KEYWORDS: [Archetype, string[]][] = [
  ["ai", ["ai ", "a.i.", "machine learning", " ml ", "llm", "genai", "generative", "nlp", "model quality"]],
  ["zero_to_one", ["0 to 1", "0-1", "zero to one", "new product", "greenfield", "from scratch", "mvp"]],
  ["growth", ["growth", "acquisition", "activation", "funnel", "experimentation", "monetiz", "monetis"]],
  ["technical", ["api", "sdk", "developer experience", "infrastructure", "system design", "backend"]],
  ["platform", ["platform", "internal tool", "data platform", "self-serve"]],
  ["b2b", ["b2b", "enterprise", "saas", "merchant", "business customer"]],
  ["b2c", ["consumer", "b2c", "mobile app", "marketplace", "shopper"]],
];

export function inferArchetype(title: string, jd: string): Archetype {
  const text = ` ${title}\n${jd} `.toLowerCase();
  for (const [archetype, kws] of ARCHETYPE_KEYWORDS) {
    if (kws.some((k) => text.includes(k))) return archetype;
  }
  return "b2c";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/tests/realPmScore.test.ts`
Expected: PASS — prints "realPmScore: all assertions passed".

> If `tsx` fails to resolve the `@/` alias, run with the tsconfig it already reads: `npx tsx --tsconfig tsconfig.json scripts/tests/realPmScore.test.ts`. (tsx v4 resolves `paths` from tsconfig by default.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/realPmScore.ts scripts/tests/realPmScore.test.ts
git commit -m "feat(stage8): rule-based real-PM scorer + archetype inference (no AI)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Ingest types, PM-title filter, and normalize

**Files:**
- Create: `src/lib/ingest/types.ts`
- Create: `src/lib/ingest/normalize.ts`
- Create: `scripts/tests/normalize.test.ts`

**Interfaces:**
- Consumes: `scoreRealPm`, `inferArchetype` from Task 2; `Role` from Task 1.
- Produces: `JobSource = "greenhouse" | "lever" | "adzuna"`; `RawJob`; `IngestSummary`; `isPmTitle(title: string): boolean`; `normalizeJob(raw: RawJob, now?: Date): Role`.

- [ ] **Step 1: Write the ingest types**

Create `src/lib/ingest/types.ts`:

```ts
// Stage 8 — shared ingestion types.

export type JobSource = "greenhouse" | "lever" | "adzuna";

// A job as returned by a source, already flattened to what we need.
export type RawJob = {
  source: JobSource;
  external_id: string;
  title: string;
  company: string;
  location: string | null;
  jd_text: string;
  apply_url: string;
};

export type IngestSummary = {
  added: number;
  updated: number;
  expired: number;
  bySource: Record<JobSource, number>;
  errors: string[];
};
```

- [ ] **Step 2: Write the failing test**

Create `scripts/tests/normalize.test.ts`:

```ts
import assert from "node:assert/strict";
import { isPmTitle, normalizeJob } from "@/lib/ingest/normalize";
import type { RawJob } from "@/lib/ingest/types";

// PM-title filter: keep real PM titles, exclude project/program manager.
assert.equal(isPmTitle("Senior Product Manager"), true);
assert.equal(isPmTitle("Associate Product Manager (APM)"), true);
assert.equal(isPmTitle("Group Product Manager"), true);
assert.equal(isPmTitle("Program Manager"), false);
assert.equal(isPmTitle("Technical Project Manager"), false);
assert.equal(isPmTitle("Data Analyst"), false);

// normalizeJob maps a RawJob into a full Role row.
const raw: RawJob = {
  source: "greenhouse",
  external_id: "4012345",
  title: "Product Manager, Growth",
  company: "Acme",
  location: "Bengaluru",
  jd_text: "Own acquisition and activation funnels; define the roadmap.",
  apply_url: "https://boards.greenhouse.io/acme/jobs/4012345",
};
const now = new Date("2026-07-07T00:00:00Z");
const role = normalizeJob(raw, now);
assert.equal(role.id, "greenhouse:4012345");
assert.equal(role.source, "greenhouse");
assert.equal(role.external_id, "4012345");
assert.equal(role.apply_url, raw.apply_url);
assert.equal(role.is_referral, false);
assert.equal(role.has_warm_path, false);
assert.equal(role.is_live, true);
assert.equal(role.crowd_response_days, 14);
assert.equal(role.ingested_at, now.toISOString());
assert.ok(Array.isArray(role.real_pm_signals) && role.real_pm_signals.length > 0);
assert.ok(role.real_pm_score >= 0 && role.real_pm_score <= 100);

console.log("normalize: all assertions passed");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx scripts/tests/normalize.test.ts`
Expected: FAIL — cannot find module `@/lib/ingest/normalize`.

- [ ] **Step 4: Write the normalizer**

Create `src/lib/ingest/normalize.ts`:

```ts
// Stage 8 — PM-title filter + RawJob → Role normalization.

import type { Role } from "@/lib/types";
import type { RawJob } from "./types";
import { scoreRealPm, inferArchetype } from "../realPmScore";

// Generic crowd-response default for ingested roles (we have no real crowd
// data for them — the seeded roles carry hand-set values).
const INGESTED_CROWD_DAYS = 14;

export function isPmTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (t.includes("project manager") || t.includes("program manager")) return false;
  return (
    t.includes("product manager") ||
    t.includes("product management") ||
    t.includes("associate product") ||
    t.includes("group product") ||
    t.includes("principal product") ||
    t.includes("head of product") ||
    t.includes("director of product") ||
    /\bapm\b/.test(t)
  );
}

export function normalizeJob(raw: RawJob, now: Date = new Date()): Role {
  const { score, signals } = scoreRealPm(raw.title, raw.jd_text);
  const iso = now.toISOString();
  return {
    id: `${raw.source}:${raw.external_id}`,
    company: raw.company,
    title: raw.title,
    archetype: inferArchetype(raw.title, raw.jd_text),
    real_pm_score: score,
    real_pm_signals: signals,
    is_live: true,
    freshness_checked_at: iso,
    location: raw.location,
    jd_text: raw.jd_text,
    crowd_response_days: INGESTED_CROWD_DAYS,
    has_warm_path: false,
    warm_path_note: null,
    is_referral: false,
    referrer_email: null,
    source: raw.source,
    external_id: raw.external_id,
    apply_url: raw.apply_url,
    ingested_at: iso,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/tests/normalize.test.ts`
Expected: PASS — prints "normalize: all assertions passed".

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest/types.ts src/lib/ingest/normalize.ts scripts/tests/normalize.test.ts
git commit -m "feat(stage8): ingest types + PM-title filter + normalizer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Source fetchers + parsers

**Files:**
- Create: `src/lib/ingest/sources.ts`
- Create: `scripts/tests/sources.test.ts`
- Modify: `src/config.ts` (add `GREENHOUSE_BOARDS`, `LEVER_COMPANIES`)
- Modify: `.env.example` (add Adzuna placeholders)

**Interfaces:**
- Consumes: `RawJob`, `JobSource` from Task 3; `GREENHOUSE_BOARDS`, `LEVER_COMPANIES` from `@/config`.
- Produces: pure parsers `parseGreenhouse(json, company): RawJob[]`, `parseLever(json, company): RawJob[]`, `parseAdzuna(json): RawJob[]`; fetchers `fetchGreenhouse(token)`, `fetchLever(company)`, `fetchAdzuna()` each returning `Promise<{ jobs: RawJob[]; error?: string }>`; `fetchAllSources(): Promise<{ jobs: RawJob[]; errors: string[] }>`.

- [ ] **Step 1: Add config lists + Adzuna env placeholders**

In `src/config.ts`, append:

```ts
// Stage 8 — job ingestion sources. These board tokens are NOT secret (they
// appear in public URLs). Add a company's token/slug here to include it in the
// next admin "Sync jobs now". Adzuna keys are secret → server env only.
export const GREENHOUSE_BOARDS: string[] = [
  // e.g. "vercel", "figma" — from boards.greenhouse.io/{token}
];
export const LEVER_COMPANIES: string[] = [
  // e.g. "netflix" — from jobs.lever.co/{company}
];
```

In `.env.example`, append:

```
# Adzuna (server-side only — job ingestion, Stage 8). Register at
# https://developer.adzuna.com to get free keys.
ADZUNA_APP_ID=your-adzuna-app-id
ADZUNA_APP_KEY=your-adzuna-app-key
```

- [ ] **Step 2: Write the failing parser test**

Create `scripts/tests/sources.test.ts`:

```ts
import assert from "node:assert/strict";
import { parseGreenhouse, parseLever, parseAdzuna } from "@/lib/ingest/sources";

// Greenhouse: { jobs: [{ id, title, absolute_url, location:{name}, content }] }
const gh = parseGreenhouse(
  { jobs: [{ id: 11, title: "Senior Product Manager", absolute_url: "https://x/11", location: { name: "Remote" }, content: "&lt;p&gt;Own the roadmap.&lt;/p&gt;" }] },
  "Acme"
);
assert.equal(gh.length, 1);
assert.equal(gh[0].source, "greenhouse");
assert.equal(gh[0].external_id, "11");
assert.equal(gh[0].company, "Acme");
assert.equal(gh[0].apply_url, "https://x/11");
assert.ok(!gh[0].jd_text.includes("<p>"), "HTML tags stripped");
assert.ok(gh[0].jd_text.includes("Own the roadmap"));

// Lever: [{ id, text, hostedUrl, categories:{location}, descriptionPlain }]
const lv = parseLever(
  [{ id: "abc", text: "Product Manager", hostedUrl: "https://l/abc", categories: { location: "Bengaluru" }, descriptionPlain: "Define what to build." }],
  "Beta"
);
assert.equal(lv[0].source, "lever");
assert.equal(lv[0].external_id, "abc");
assert.equal(lv[0].location, "Bengaluru");

// Adzuna: { results: [{ id, title, redirect_url, location:{display_name}, description, company:{display_name} }] }
const az = parseAdzuna({
  results: [{ id: "99", title: "Group Product Manager", redirect_url: "https://a/99", location: { display_name: "Mumbai" }, description: "Own discovery.", company: { display_name: "Gamma" } }],
});
assert.equal(az[0].source, "adzuna");
assert.equal(az[0].company, "Gamma");
assert.equal(az[0].apply_url, "https://a/99");

console.log("sources: all assertions passed");
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx scripts/tests/sources.test.ts`
Expected: FAIL — cannot find module `@/lib/ingest/sources`.

- [ ] **Step 4: Write the sources module**

Create `src/lib/ingest/sources.ts`:

```ts
// Stage 8 — source fetchers + pure parsers for Greenhouse, Lever, Adzuna.
// Parsers are pure (unit-tested). Fetchers are best-effort: a failing source
// returns an error string but never throws, so one bad source can't kill a sync.

import type { RawJob } from "./types";
import { GREENHOUSE_BOARDS, LEVER_COMPANIES } from "@/config";

const ADZUNA_MAX = 50; // cost-safety cap (one query, <= 50 rows)

function stripHtml(s: string): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Pure parsers ------------------------------------------------------------

export function parseGreenhouse(json: unknown, company: string): RawJob[] {
  const jobs = (json as { jobs?: unknown[] })?.jobs ?? [];
  return jobs.map((j) => {
    const job = j as { id: number | string; title: string; absolute_url: string; location?: { name?: string }; content?: string };
    return {
      source: "greenhouse" as const,
      external_id: String(job.id),
      title: job.title ?? "",
      company,
      location: job.location?.name ?? null,
      jd_text: stripHtml(job.content ?? ""),
      apply_url: job.absolute_url ?? "",
    };
  });
}

export function parseLever(json: unknown, company: string): RawJob[] {
  const arr = Array.isArray(json) ? json : [];
  return arr.map((j) => {
    const job = j as { id: string; text: string; hostedUrl: string; categories?: { location?: string }; descriptionPlain?: string };
    return {
      source: "lever" as const,
      external_id: String(job.id),
      title: job.text ?? "",
      company,
      location: job.categories?.location ?? null,
      jd_text: (job.descriptionPlain ?? "").trim(),
      apply_url: job.hostedUrl ?? "",
    };
  });
}

export function parseAdzuna(json: unknown): RawJob[] {
  const results = (json as { results?: unknown[] })?.results ?? [];
  return results.map((r) => {
    const job = r as { id: string | number; title: string; redirect_url: string; location?: { display_name?: string }; description?: string; company?: { display_name?: string } };
    return {
      source: "adzuna" as const,
      external_id: String(job.id),
      title: job.title ?? "",
      company: job.company?.display_name ?? "Unknown",
      location: job.location?.display_name ?? null,
      jd_text: (job.description ?? "").trim(),
      apply_url: job.redirect_url ?? "",
    };
  });
}

// --- Fetchers (best-effort) --------------------------------------------------

type FetchResult = { jobs: RawJob[]; error?: string };

export async function fetchGreenhouse(token: string): Promise<FetchResult> {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
    if (!res.ok) return { jobs: [], error: `greenhouse ${token}: HTTP ${res.status}` };
    return { jobs: parseGreenhouse(await res.json(), titleCase(token)) };
  } catch {
    return { jobs: [], error: `greenhouse ${token}: request failed` };
  }
}

export async function fetchLever(company: string): Promise<FetchResult> {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${company}?mode=json`);
    if (!res.ok) return { jobs: [], error: `lever ${company}: HTTP ${res.status}` };
    return { jobs: parseLever(await res.json(), titleCase(company)) };
  } catch {
    return { jobs: [], error: `lever ${company}: request failed` };
  }
}

export async function fetchAdzuna(): Promise<FetchResult> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { jobs: [], error: "adzuna: keys not configured" };
  try {
    const url = `https://api.adzuna.com/v1/api/jobs/in/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=${ADZUNA_MAX}&what=${encodeURIComponent("product manager")}&content-type=application/json`;
    const res = await fetch(url);
    if (!res.ok) return { jobs: [], error: `adzuna: HTTP ${res.status}` };
    return { jobs: parseAdzuna(await res.json()) };
  } catch {
    return { jobs: [], error: "adzuna: request failed" };
  }
}

// Fetch every configured source, collecting jobs and per-source errors.
export async function fetchAllSources(): Promise<{ jobs: RawJob[]; errors: string[] }> {
  const results = await Promise.all([
    ...GREENHOUSE_BOARDS.map((t) => fetchGreenhouse(t)),
    ...LEVER_COMPANIES.map((c) => fetchLever(c)),
    fetchAdzuna(),
  ]);
  const jobs: RawJob[] = [];
  const errors: string[] = [];
  for (const r of results) {
    jobs.push(...r.jobs);
    if (r.error) errors.push(r.error);
  }
  return { jobs, errors };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/tests/sources.test.ts`
Expected: PASS — prints "sources: all assertions passed".

- [ ] **Step 6: Commit**

```bash
git add src/lib/ingest/sources.ts scripts/tests/sources.test.ts src/config.ts .env.example
git commit -m "feat(stage8): source fetchers + parsers (Greenhouse/Lever/Adzuna) + config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Pipeline (dedupe, expire, orchestration)

**Files:**
- Create: `src/lib/ingest/pipeline.ts`
- Create: `scripts/tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `RawJob`, `IngestSummary`, `JobSource` (Task 3); `fetchAllSources` (Task 4); `isPmTitle`, `normalizeJob` (Task 3); a Supabase client.
- Produces: pure helpers `dedupe(jobs: RawJob[]): RawJob[]` and `classifyExpiry(existingIngestedIds: string[], freshIds: string[]): string[]`; `runIngest(client: SupabaseClient): Promise<IngestSummary>`.

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `scripts/tests/pipeline.test.ts`:

```ts
import assert from "node:assert/strict";
import { dedupe, classifyExpiry } from "@/lib/ingest/pipeline";
import type { RawJob } from "@/lib/ingest/types";

const base = { title: "Product Manager", company: "Acme", location: "Remote", jd_text: "x", apply_url: "u" };

// Same company/title/location from two sources → one row kept, ATS preferred.
const deduped = dedupe([
  { ...base, source: "adzuna", external_id: "a1" } as RawJob,
  { ...base, source: "greenhouse", external_id: "g1" } as RawJob,
]);
assert.equal(deduped.length, 1);
assert.equal(deduped[0].source, "greenhouse");

// Distinct jobs are all kept.
const two = dedupe([
  { ...base, source: "greenhouse", external_id: "g1" } as RawJob,
  { ...base, title: "Senior PM", source: "greenhouse", external_id: "g2" } as RawJob,
]);
assert.equal(two.length, 2);

// Expiry: existing ingested ids not present in the fresh pull are expired.
const expired = classifyExpiry(["greenhouse:g1", "lever:l9"], ["greenhouse:g1"]);
assert.deepEqual(expired, ["lever:l9"]);

console.log("pipeline: all assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/tests/pipeline.test.ts`
Expected: FAIL — cannot find module `@/lib/ingest/pipeline`.

- [ ] **Step 3: Write the pipeline**

Create `src/lib/ingest/pipeline.ts`:

```ts
// Stage 8 — ingest orchestration. Pure helpers (dedupe, classifyExpiry) are
// unit-tested; runIngest does the Supabase I/O with the admin's forwarded
// client so writes pass the roles admin-write RLS.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawJob, IngestSummary, JobSource } from "./types";
import { isPmTitle, normalizeJob } from "./normalize";
import { fetchAllSources } from "./sources";

const SOURCE_ORDER: Record<JobSource, number> = { greenhouse: 0, lever: 1, adzuna: 2 };

// Dedupe by (source:external_id), then cross-source by company|title|location.
// ATS sources (greenhouse, lever) win over Adzuna when the same job appears twice.
export function dedupe(jobs: RawJob[]): RawJob[] {
  const sorted = [...jobs].sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]);
  const seenId = new Set<string>();
  const seenKey = new Set<string>();
  const out: RawJob[] = [];
  for (const j of sorted) {
    const id = `${j.source}:${j.external_id}`;
    const key = `${j.company}|${j.title}|${j.location ?? ""}`.toLowerCase();
    if (seenId.has(id) || seenKey.has(key)) continue;
    seenId.add(id);
    seenKey.add(key);
    out.push(j);
  }
  return out;
}

export function classifyExpiry(existingIngestedIds: string[], freshIds: string[]): string[] {
  const fresh = new Set(freshIds);
  return existingIngestedIds.filter((id) => !fresh.has(id));
}

const INGESTED_SOURCES: JobSource[] = ["greenhouse", "lever", "adzuna"];

export async function runIngest(client: SupabaseClient): Promise<IngestSummary> {
  const bySource: Record<JobSource, number> = { greenhouse: 0, lever: 0, adzuna: 0 };

  // 1) Fetch + filter to PM titles + dedupe.
  const { jobs: rawJobs, errors } = await fetchAllSources();
  const pmJobs = dedupe(rawJobs.filter((j) => j.title && isPmTitle(j.title) && j.apply_url));

  // 2) Normalize to Role rows.
  const now = new Date();
  const rows = pmJobs.map((j) => {
    bySource[j.source] += 1;
    return normalizeJob(j, now);
  });
  const freshIds = rows.map((r) => r.id);

  // 3) Figure out which ingested ids already exist (added vs updated).
  const { data: existingRows, error: exErr } = await client
    .from("roles")
    .select("id")
    .in("source", INGESTED_SOURCES);
  if (exErr) errors.push(`read existing: ${exErr.message}`);
  const existingIngestedIds = (existingRows ?? []).map((r: { id: string }) => r.id);
  const existingSet = new Set(existingIngestedIds);
  const added = freshIds.filter((id) => !existingSet.has(id)).length;
  const updated = freshIds.length - added;

  // 4) Upsert the fresh rows (RLS: admin JWT on `client`).
  if (rows.length > 0) {
    const { error: upErr } = await client.from("roles").upsert(rows, { onConflict: "id" });
    if (upErr) errors.push(`upsert: ${upErr.message}`);
  }

  // 5) Expire ingested rows missing from this pull. NEVER touches seed/referral
  //    rows — the .in("source", INGESTED_SOURCES) filter excludes source='seed'.
  const toExpire = classifyExpiry(existingIngestedIds, freshIds);
  let expired = 0;
  if (toExpire.length > 0) {
    const { error: expErr } = await client
      .from("roles")
      .update({ is_live: false, freshness_checked_at: now.toISOString() })
      .in("id", toExpire);
    if (expErr) errors.push(`expire: ${expErr.message}`);
    else expired = toExpire.length;
  }

  return { added, updated, expired, bySource, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/tests/pipeline.test.ts`
Expected: PASS — prints "pipeline: all assertions passed".

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest/pipeline.ts scripts/tests/pipeline.test.ts
git commit -m "feat(stage8): ingest pipeline — dedupe, upsert, expire stale

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Ingest route (admin-gated, JWT-forwarded writes)

**Files:**
- Create: `src/app/api/ingest/route.ts`

**Interfaces:**
- Consumes: `runIngest` (Task 5); `isAdminEmail` from `@/config`.
- Produces: `POST /api/ingest` → `IngestSummary` JSON (200) or `{ error }` (401/403/500).

- [ ] **Step 1: Write the route**

Create `src/app/api/ingest/route.ts`:

```ts
// Stage 8 — admin-triggered job ingestion. POST only. Writes to the RLS-locked
// `roles` table by forwarding the signed-in admin's Supabase JWT (Decision A1)
// — NO service_role key. Re-checks admin server-side. No AI call.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/config";
import { runIngest } from "@/lib/ingest/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 500 });
  }

  // Per-request client carrying the caller's JWT → RLS evaluates is_admin()
  // against their identity, so admin writes to `roles` pass.
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await client.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }
  if (!isAdminEmail(userData.user.email)) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  try {
    const summary = await runIngest(client);
    return NextResponse.json(summary);
  } catch {
    // Never echo keys or raw upstream bodies.
    return NextResponse.json({ error: "Ingest failed. Check server logs." }, { status: 500 });
  }
  // TODO(v2): Vercel Cron for automatic daily sync (crons in vercel config).
}
```

- [ ] **Step 2: Verify build registers the route**

Run: `npx tsc --noEmit && npx next build`
Expected: PASS; build output lists `/api/ingest` as a route.

- [ ] **Step 3: Verify the auth gate returns 401 without a token**

Run (dev server in another terminal via `npm run dev`):
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/ingest
```
Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ingest/route.ts
git commit -m "feat(stage8): POST /api/ingest — admin-gated, JWT-forwarded writes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Source badge + wire into RoleCard and role detail

**Files:**
- Modify: `src/components/role-badges.tsx` (add `SourceBadge` + `sourceLabel`)
- Modify: `src/components/RoleCard.tsx:42-46` (show `SourceBadge`)
- Modify: `src/app/roles/[id]/page.tsx:60-65` (show `SourceBadge` in header)

**Interfaces:**
- Produces: `SourceBadge({ source }: { source: string | null })`; `sourceLabel(source: string | null): string`.

- [ ] **Step 1: Add `SourceBadge` + `sourceLabel`**

In `src/components/role-badges.tsx`, add before the `// --- Stage 2.5` comment:

```tsx
// Stage 8 — provenance badge. 'seed' = illustrative sample data (deletable);
// greenhouse/lever/adzuna = ingested from a live source.
const SOURCE_META: Record<string, { label: string; cls: string }> = {
  seed: { label: "Sample", cls: "bg-surface-alt text-muted" },
  greenhouse: { label: "Greenhouse", cls: "bg-info-soft text-info" },
  lever: { label: "Lever", cls: "bg-info-soft text-info" },
  adzuna: { label: "Adzuna", cls: "bg-info-soft text-info" },
};

export function SourceBadge({ source }: { source: string | null }) {
  const m = source ? SOURCE_META[source] : null;
  if (!m) return null;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

export function sourceLabel(source: string | null): string {
  return source && SOURCE_META[source] ? SOURCE_META[source].label : "site";
}
```

- [ ] **Step 2: Show the badge on `RoleCard`**

In `src/components/RoleCard.tsx`, add `SourceBadge` to the imports from `@/components/role-badges`, then in the badge row (currently lines 42-46) add it after `ReferralBadge`:

```tsx
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ScoreBadge score={role.real_pm_score} />
        <ArchetypeTag archetype={role.archetype} />
        {role.is_referral && <ReferralBadge />}
        <SourceBadge source={role.source} />
      </div>
```

- [ ] **Step 3: Show the badge on the role-detail header**

In `src/app/roles/[id]/page.tsx`, add `SourceBadge` to the imports from `@/components/role-badges`, then in the header badge row (lines 61-65) add after `ReferralBadge`:

```tsx
        <div className="flex flex-wrap items-center gap-2">
          <ArchetypeTag archetype={role.archetype} />
          <FreshnessFlag isLive={role.is_live} checkedAt={role.freshness_checked_at} />
          {role.is_referral && <ReferralBadge />}
          <SourceBadge source={role.source} />
        </div>
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit && npx next build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/role-badges.tsx src/components/RoleCard.tsx src/app/roles/[id]/page.tsx
git commit -m "feat(stage8): source/sample badge on role card + detail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Apply-out button for ingested roles

**Files:**
- Create: `src/components/ApplyOutButton.tsx`
- Modify: `src/app/roles/[id]/page.tsx:79-83` (branch on `apply_url`)

**Interfaces:**
- Consumes: `sourceLabel` (Task 7).
- Produces: `ApplyOutButton({ url, source }: { url: string; source: string })`.

- [ ] **Step 1: Write the component**

Create `src/components/ApplyOutButton.tsx`:

```tsx
import { ArrowUpRight } from "lucide-react";

// Stage 8 — ingested roles link OUT to the real posting (no fake apply).
export function ApplyOutButton({ url, source }: { url: string; source: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
    >
      Apply on {source}
      <ArrowUpRight className="h-4 w-4" aria-hidden />
    </a>
  );
}
```

- [ ] **Step 2: Branch the apply CTA in role detail**

In `src/app/roles/[id]/page.tsx`, add imports:

```tsx
import { ApplyOutButton } from "@/components/ApplyOutButton";
import { sourceLabel } from "@/components/role-badges";
```

Replace the apply branch (lines 79-83) with a three-way branch:

```tsx
        {role.is_referral ? (
          <ReferralApplyButton role={role} />
        ) : role.apply_url ? (
          <ApplyOutButton url={role.apply_url} source={sourceLabel(role.source)} />
        ) : (
          <ApplyButton roleId={role.id} />
        )}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npx next build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ApplyOutButton.tsx src/app/roles/[id]/page.tsx
git commit -m "feat(stage8): external Apply button for ingested (cold-path) roles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Admin "Sync jobs now" button + summary

**Files:**
- Modify: `src/app/admin/page.tsx` (add `SyncJobsPanel`, render it in the admin block)

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `IngestSummary` from `@/lib/ingest/types`; `POST /api/ingest` (Task 6).

- [ ] **Step 1: Add imports**

In `src/app/admin/page.tsx`, add to the existing imports:

```tsx
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { IngestSummary } from "@/lib/ingest/types";
```

- [ ] **Step 2: Render the panel in the admin block**

In the admin branch (currently `<PostReferralForm /> <ReferralOverview />` inside the `<div className="mt-6 space-y-8">`), add `SyncJobsPanel` first:

```tsx
        <div className="mt-6 space-y-8">
          <SyncJobsPanel />
          <PostReferralForm />
          <ReferralOverview />
        </div>
```

- [ ] **Step 3: Add the `SyncJobsPanel` component**

Add at the end of `src/app/admin/page.tsx`:

```tsx
// --- Stage 8: trigger a job sync ---------------------------------------------

function SyncJobsPanel() {
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [summary, setSummary] = useState<IngestSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setState("syncing");
    setError(null);
    setSummary(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setError("Session expired — sign in again.");
      setState("error");
      return;
    }
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Sync failed.");
        setState("error");
        return;
      }
      setSummary(body as IngestSummary);
      setState("done");
    } catch {
      setError("Network error — try again.");
      setState("error");
    }
  }

  return (
    <section className="rounded-card border border-border bg-surface p-5 shadow-[var(--shadow-warm)] sm:p-6">
      <h2 className="inline-flex items-center gap-2 font-heading text-lg font-bold text-ink">
        <RefreshCw className="h-4 w-4 text-primary" aria-hidden />
        Sync jobs
      </h2>
      <p className="mt-1 text-sm text-muted">
        Pull PM roles from the configured Greenhouse, Lever, and Adzuna sources.
        No AI credits used.
      </p>

      <button
        type="button"
        onClick={sync}
        disabled={state === "syncing"}
        className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {state === "syncing" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
        {state === "syncing" ? "Syncing…" : "Sync jobs now"}
      </button>

      {state === "error" && error ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-danger">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error}
        </p>
      ) : null}

      {state === "done" && summary ? (
        <div className="mt-4 rounded-card border border-border bg-surface-alt px-4 py-3 text-sm text-ink">
          <p className="font-semibold">
            <span className="text-success">{summary.added} added</span> ·{" "}
            {summary.updated} updated · {summary.expired} expired
          </p>
          <p className="mt-1 text-xs text-muted">
            Greenhouse {summary.bySource.greenhouse} · Lever{" "}
            {summary.bySource.lever} · Adzuna {summary.bySource.adzuna}
          </p>
          {summary.errors.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs text-accent">
              {summary.errors.map((e, i) => (
                <li key={i} className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {e}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit && npx next build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(stage8): admin 'Sync jobs now' button + summary card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Full verification + docs + how-to

**Files:**
- Modify: `README.md` (Stage 8 note + how-to)
- Modify: `knowledge/SESSION_JOURNAL.md`, `knowledge/DECISIONS.md`, `PRD.md`

- [ ] **Step 1: Run the whole test suite + build**

Run:
```bash
npx tsx scripts/tests/realPmScore.test.ts
npx tsx scripts/tests/normalize.test.ts
npx tsx scripts/tests/sources.test.ts
npx tsx scripts/tests/pipeline.test.ts
npx tsc --noEmit
npx next build
```
Expected: all four tests print "all assertions passed"; tsc + build clean.

- [ ] **Step 2: Run the DB migration (human)**

In the Supabase SQL editor, run `scripts/stage8-job-ingestion.sql`. Confirm: `select source, count(*) from roles group by source;` shows 50 rows at `source='seed'`.

- [ ] **Step 3: Live sync smoke test (human + agent)**

- Add one real board to `src/config.ts` `GREENHOUSE_BOARDS` (a company known to use Greenhouse), commit, deploy (or run `npm run dev`).
- Set `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` in `.env.local` (and Vercel env for prod).
- Sign in as an admin → `/admin` → **"Sync jobs now"**.
- Expected: summary shows `added > 0`; `/roles` shows new rows badged "Greenhouse"/"Adzuna"; opening one shows **"Apply on … ↗"** linking out. The write succeeding **proves the JWT/RLS path** (a non-admin session would 403).

- [ ] **Step 4: Write the how-to + update knowledge docs**

Append to `README.md` a "Stage 8 — job ingestion" section with:
1. Add a Greenhouse company: put its `{token}` (from `boards.greenhouse.io/{token}`) into `GREENHOUSE_BOARDS` in `src/config.ts`; commit → deploy.
2. Add a Lever company: put its `{company}` (from `jobs.lever.co/{company}`) into `LEVER_COMPANIES`.
3. Set Adzuna keys: register at `developer.adzuna.com`; add `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` to `.env.local` and Vercel env (Production); redeploy.
4. Run a sync: sign in as admin → `/admin` → "Sync jobs now" → read the summary.

Update `knowledge/SESSION_JOURNAL.md` (new session entry + Current State), `knowledge/DECISIONS.md` (JWT-forward write path; rule-based scorer; source='seed' tagging), and `PRD.md` (add feature 5.10 Job ingestion).

- [ ] **Step 5: Commit**

```bash
git add README.md knowledge/SESSION_JOURNAL.md knowledge/DECISIONS.md PRD.md
git commit -m "docs(stage8): how-to for job ingestion + journal/decisions/PRD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (spec §→task):
- §2 sources → Task 4. §3 decisions (JWT write, scorer, seed tag) → Tasks 6, 2, 1. §4 schema → Task 1. §5 config/secrets → Task 4. §6 scorer → Task 2. §7 pipeline (filter/normalize/dedupe/upsert/expire) → Tasks 3, 5. §8 route → Task 6. §9 UI (badge, apply-out, sync button) → Tasks 7, 8, 9. §10 states/testing → Tasks 2–6 + Task 10. §12 how-to → Task 10. §13 files → all tasks. **No gaps.**
- `crowd_response_days` NOT NULL → default 14 in `normalizeJob` (Task 3). `real_pm_signals` NOT NULL → scorer always returns ≥1 signal (Task 2). Both covered.
- Expire pass never touches seed/referral rows → enforced by `.in("source", INGESTED_SOURCES)` (Task 5), verified in reasoning.

**Placeholder scan:** the only `TODO` is the intentional `// TODO(v2): Vercel Cron` (spec-required). No unresolved placeholders.

**Type consistency:** `RawJob`, `JobSource`, `IngestSummary` defined in Task 3, consumed unchanged in Tasks 4–6/9. `scoreRealPm`/`inferArchetype` signatures match between Task 2 and Task 3. `SourceBadge`/`sourceLabel` defined Task 7, consumed Task 8. `runIngest(client)` defined Task 5, called Task 6. Consistent.
