// Stage 17.1 — export ingested JDs and build the labeling set. Read-only (anon).
// Writes:
//   docs/scorer_jds_export.json  — up to 100 most-recent ingested JDs (full, with
//                                  current scorer output, for internal analysis)
//   docs/scorer_eval.json        — 30 rows spanning the current score range, with
//                                  BLANK labels for the product owner to fill. No
//                                  score shown there → avoids anchoring the labeler.
// Run: node scripts/stage17-export-eval.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { scoreRealPm, inferArchetype } from "../src/lib/realPmScore.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const { data, error } = await supabase
  .from("roles")
  .select("id,company,title,archetype,source,is_live,jd_text,freshness_checked_at");
if (error) {
  console.error("Read failed:", error.message);
  process.exit(1);
}

// Ingested (non-seed), live, with a usable JD. Most recent first.
const ingested = data
  .filter((r) => r.source && r.source !== "seed" && r.is_live && (r.jd_text ?? "").trim().length > 200)
  .sort((a, b) => (b.freshness_checked_at ?? "").localeCompare(a.freshness_checked_at ?? ""))
  .slice(0, 100)
  .map((r) => {
    const { score } = scoreRealPm(r.title, r.jd_text ?? "");
    return { ...r, current_score: score, current_archetype: inferArchetype(r.title, r.jd_text ?? "") };
  });

writeFileSync(new URL("../docs/scorer_jds_export.json", import.meta.url), JSON.stringify(ingested, null, 2));

// Balanced 30: ~10 each from low (<40), mid (40-69), high (70+) current scores, so
// the eval spans disguised / verify / genuine candidates rather than one band.
const low = ingested.filter((r) => r.current_score < 40);
const mid = ingested.filter((r) => r.current_score >= 40 && r.current_score < 70);
const high = ingested.filter((r) => r.current_score >= 70);
// Take all low-scorers (scarce), then fill toward 30 evenly from mid + high.
const chosen = [...low.slice(0, 10), ...mid.slice(0, 13), ...high.slice(0, 13)].slice(0, 30);

const evalRows = chosen.map((r) => ({
  id: r.id,
  company: r.company,
  title: r.title,
  jd_text: (r.jd_text ?? "").trim().slice(0, 1500),
  // Fill each with one of: "genuine" | "verify" | "disguised". Leave "" untouched
  // for any you skip. Do NOT peek at the current score — label from the JD alone.
  label: "",
}));

writeFileSync(new URL("../docs/scorer_eval.json", import.meta.url), JSON.stringify(evalRows, null, 2));

console.log(`Exported ${ingested.length} JDs → docs/scorer_jds_export.json`);
console.log(`Labeling set: ${evalRows.length} rows → docs/scorer_eval.json (labels blank)`);
console.log(`Score spread available — low<40: ${low.length}, mid 40-69: ${mid.length}, high 70+: ${high.length}`);
