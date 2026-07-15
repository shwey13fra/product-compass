// Stage 4/11 — LIVE positioning. Server-side ONLY: holds ANTHROPIC_API_KEY and
// calls the Anthropic Messages API. The key never reaches the browser. The
// manual paste-in path (Stage 3) stays a zero-credit, unlimited fallback.
//
// Stage 11 — budget protection is now DURABLE (survives cold starts), enforced
// in Postgres via SECURITY DEFINER functions (anon key only, never service-role):
//   * increment_ai_usage(identity, limit) — atomic monthly quota per identity
//     (auth user id if signed in, else compass_uid). The client can't race/spoof it.
//   * check_ip_rate(ip, limit) — coarse hourly IP backstop against compass_uid
//     rotation (clearing localStorage for fresh quota).
// Validation 400s consume NEITHER (they return before any counter is touched).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types";
import type { ExperienceProfile } from "@/lib/experience";
import { buildPositioningPrompt, parseBrief } from "@/lib/positioning";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/errors";

export const runtime = "nodejs"; // need process.env (not the edge runtime)
export const dynamic = "force-dynamic";

// dev/validate: haiku (cheapest). Bump to claude-sonnet-4-6 for the demo.
const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1024; // the brief is small (4 short fields) — keep it tight
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Durable limits (config via server env). Monthly quota per identity; hourly cap
// per IP as the rotation backstop.
const MONTHLY_LIMIT = Number(process.env.AI_MONTHLY_LIMIT ?? 15);
const IP_HOURLY_LIMIT = Number(process.env.AI_IP_HOURLY_LIMIT ?? 10);

type Body = { role?: Partial<Role>; profile?: Partial<ExperienceProfile> };

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return (req.headers.get("x-real-ip") ?? "").trim();
}

// Identity for the monthly quota. Prefer the VERIFIED auth user id (so a
// signed-in user can't be spoofed onto someone else's bucket); else the
// compass_uid header; else fall back to the IP so metering always happens.
async function resolveIdentity(req: Request, ip: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization");
  if (auth && /^bearer /i.test(auth) && url && anon) {
    try {
      const token = auth.slice(7).trim();
      const scoped = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data } = await scoped.auth.getUser();
      if (data.user?.id) return data.user.id;
    } catch {
      // fall through to the anonymous identity
    }
  }
  const uid = req.headers.get("x-compass-uid")?.trim();
  return uid || (ip ? `ip:${ip}` : "");
}

export async function POST(req: Request) {
  // --- validate input (400s consume NOTHING) -------------------------------
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const role = body.role;
  const profile = body.profile;
  if (!role?.company || !role?.title || !role?.archetype) {
    return NextResponse.json({ ok: false, error: "Missing role details." }, { status: 400 });
  }
  if (!profile?.experience || profile.experience.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Add your experience before positioning." },
      { status: 400 }
    );
  }

  // --- key must exist server-side (server misconfig → no consumption) -------
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await logError("api/position", "missing ANTHROPIC_API_KEY", {});
    return NextResponse.json(
      {
        ok: false,
        error:
          "Server is missing ANTHROPIC_API_KEY. Add it to the server environment, or use the manual paste-in.",
      },
      { status: 500 }
    );
  }

  const ip = clientIp(req);
  const identity = await resolveIdentity(req, ip);

  // --- IP rate backstop first (catches uid rotation before touching quota) --
  try {
    const { data, error } = await supabase.rpc("check_ip_rate", {
      p_ip: ip,
      p_limit: IP_HOURLY_LIMIT,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row && row.allowed === false) {
      return NextResponse.json(
        {
          ok: false,
          rateLimited: true,
          error:
            "You're going a bit fast — too many live runs in the last hour. Wait a little, or use the manual paste-in (free).",
          callsRemaining: null,
        },
        { status: 429 }
      );
    }
    // On rpc error: fail OPEN (the monthly quota below is the real budget guard).
    if (error) await logError("api/position", "check_ip_rate failed (fail-open)", {});
  } catch {
    await logError("api/position", "check_ip_rate threw (fail-open)", {});
  }

  // --- durable monthly quota (the real budget guard) ------------------------
  let callsRemaining = 0;
  try {
    const { data, error } = await supabase.rpc("increment_ai_usage", {
      p_identity: identity,
      p_limit: MONTHLY_LIMIT,
    });
    if (error) {
      // Fail CLOSED: if we can't verify the quota, don't spend uncapped credit.
      await logError("api/position", "increment_ai_usage failed (fail-closed)", {});
      return NextResponse.json(
        {
          ok: false,
          error:
            "Live positioning is briefly unavailable (usage check failed). The manual paste-in is free — use that.",
          callsRemaining: 0,
        },
        { status: 503 }
      );
    }
    const row = Array.isArray(data) ? data[0] : data;
    callsRemaining = row?.remaining ?? 0;
    if (!row || row.allowed === false) {
      return NextResponse.json(
        {
          ok: false,
          limitReached: true,
          error: `You've used all ${MONTHLY_LIMIT} live positionings this month. The manual paste-in is free and unlimited — use that, or come back next month.`,
          callsRemaining: 0,
        },
        { status: 429 }
      );
    }
  } catch {
    await logError("api/position", "increment_ai_usage threw (fail-closed)", {});
    return NextResponse.json(
      {
        ok: false,
        error: "Live positioning is briefly unavailable. Use the manual paste-in (free).",
        callsRemaining: 0,
      },
      { status: 503 }
    );
  }

  const prompt = buildPositioningPrompt(role as Role, profile as ExperienceProfile);

  // --- call Anthropic (quota already consumed for this attempt) -------------
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
    await logError("api/position", "anthropic fetch failed (network)", {});
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
    await logError("api/position", "anthropic non-ok response", { status });
    return NextResponse.json({ ok: false, error: hint, callsRemaining }, { status: 502 });
  }

  const data = (await res.json()) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  };

  if (data.stop_reason === "refusal") {
    await logError("api/position", "anthropic refusal", {});
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
    // Log the parser's reason only — NOT the model text (derived from the user's
    // experience → potential PII).
    await logError("api/position", "unparseable model output", { reason: parsed.error });
    return NextResponse.json(
      { ok: false, error: `Model returned unparseable output: ${parsed.error}`, callsRemaining },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, brief: parsed.brief, callsRemaining });
}
