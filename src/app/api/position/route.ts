// Stage 4 — LIVE positioning. Server-side ONLY: holds ANTHROPIC_API_KEY and
// calls the Anthropic Messages API. The key is read from the server environment
// and never sent to the browser. The manual paste-in path (Stage 3) stays as a
// zero-credit fallback; this route is the live layer on top.
//
// Credit-safe (€5 budget): cheap model + capped max_tokens + a per-process call
// counter that hard-stops after MAX_CALLS and warns the client.

import { NextResponse } from "next/server";
import type { Role } from "@/lib/types";
import type { ExperienceProfile } from "@/lib/experience";
import { buildPositioningPrompt, parseBrief } from "@/lib/positioning";

export const runtime = "nodejs"; // need process.env (not the edge runtime)
export const dynamic = "force-dynamic";

// dev/validate: haiku (cheapest). Bump to claude-sonnet-4-6 for the demo.
const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1024; // the brief is small (4 short fields) — keep it tight
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Per-process call counter — protects the €5 budget. Resets on cold start,
// which is fine for a dev/demo guard. Override the cap with POSITION_CALL_CAP.
const MAX_CALLS = Number(process.env.POSITION_CALL_CAP ?? 15);
let callCount = 0;

type Body = { role?: Partial<Role>; profile?: Partial<ExperienceProfile> };

export async function POST(req: Request) {
  // --- validate input -------------------------------------------------------
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const role = body.role;
  const profile = body.profile;
  if (!role?.company || !role?.title || !role?.archetype) {
    return NextResponse.json(
      { ok: false, error: "Missing role details." },
      { status: 400 }
    );
  }
  if (!profile?.experience || profile.experience.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Add your experience before positioning." },
      { status: 400 }
    );
  }

  // --- guard the budget -----------------------------------------------------
  if (callCount >= MAX_CALLS) {
    return NextResponse.json(
      {
        ok: false,
        limitReached: true,
        error: `Live positioning is paused after ${MAX_CALLS} calls this session to protect the budget. Use the manual paste-in instead, or restart the server to reset.`,
        callsRemaining: 0,
      },
      { status: 429 }
    );
  }

  // --- key must exist server-side -------------------------------------------
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Server is missing ANTHROPIC_API_KEY. Add it to the server environment, or use the manual paste-in.",
      },
      { status: 500 }
    );
  }

  const prompt = buildPositioningPrompt(role as Role, profile as ExperienceProfile);

  // --- call Anthropic -------------------------------------------------------
  callCount += 1; // count the attempt so a hammered endpoint still hits the cap
  const callsRemaining = Math.max(0, MAX_CALLS - callCount);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Couldn't reach the model. Try again or paste in manually.", callsRemaining },
      { status: 502 }
    );
  }

  if (!res.ok) {
    // Surface a useful but non-leaky message (never echo the key or raw body).
    const status = res.status;
    const hint =
      status === 401
        ? "The server's API key was rejected."
        : status === 429
        ? "Anthropic rate-limited the request — wait a moment."
        : "The model request failed.";
    return NextResponse.json({ ok: false, error: hint, callsRemaining }, { status: 502 });
  }

  const data = (await res.json()) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  };

  if (data.stop_reason === "refusal") {
    return NextResponse.json(
      { ok: false, error: "The model declined this request. Try the manual paste-in.", callsRemaining },
      { status: 502 }
    );
  }

  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  const parsed = parseBrief(text);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: `Model returned unparseable output: ${parsed.error}`, callsRemaining },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, brief: parsed.brief, callsRemaining });
}
