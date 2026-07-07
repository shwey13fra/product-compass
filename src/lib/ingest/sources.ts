// Stage 8 — source fetchers + pure parsers for Greenhouse, Lever, Adzuna.
// Parsers are pure (unit-tested). Fetchers are best-effort: a failing source
// returns an error string but never throws, so one bad source can't kill a sync.

import type { RawJob } from "./types";
import { GREENHOUSE_BOARDS, LEVER_COMPANIES } from "@/config";

const ADZUNA_MAX = 50; // cost-safety cap (one query, <= 50 rows)

// Decode HTML entities FIRST, then strip tags. Greenhouse content is
// entity-encoded (&lt;h2&gt;), so decoding first lets the tag-strip remove them.
function stripHtml(s: string): string {
  return (s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, " ")
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
    const job = j as {
      id: number | string;
      title: string;
      absolute_url: string;
      location?: { name?: string } | null;
      content?: string;
      company_name?: string;
    };
    return {
      source: "greenhouse" as const,
      external_id: String(job.id),
      title: job.title ?? "",
      company: job.company_name?.trim() || company,
      location: job.location?.name ?? null,
      jd_text: stripHtml(job.content ?? ""),
      apply_url: job.absolute_url ?? "",
    };
  });
}

export function parseLever(json: unknown, company: string): RawJob[] {
  const arr = Array.isArray(json) ? json : [];
  return arr.map((j) => {
    const job = j as {
      id: string;
      text: string;
      hostedUrl: string;
      categories?: { location?: string };
      descriptionPlain?: string;
    };
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
    const job = r as {
      id: string | number;
      title: string;
      redirect_url: string;
      location?: { display_name?: string };
      description?: string;
      company?: { display_name?: string };
    };
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
