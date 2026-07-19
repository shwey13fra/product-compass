// Stage 17 reality check — count roles by source/is_live using the anon client
// (roles are publicly readable). Read-only. Run: node scripts/stage17-count-roles.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
  .select("source,is_live,jd_text");

if (error) {
  console.error("Read failed:", error.message);
  process.exit(1);
}

const bySource = {};
let liveIngested = 0;
let withUsableJd = 0;
for (const r of data) {
  const src = r.source ?? "(null)";
  bySource[src] ??= { total: 0, live: 0 };
  bySource[src].total++;
  if (r.is_live) bySource[src].live++;
  const ingested = src !== "seed" && src !== "(null)";
  if (ingested && r.is_live) liveIngested++;
  if (ingested && (r.jd_text ?? "").trim().length > 200) withUsableJd++;
}

console.log("Total roles:", data.length);
console.log("By source {total, live}:", JSON.stringify(bySource, null, 2));
console.log("Live INGESTED roles (non-seed):", liveIngested, "  (sample-retirement threshold = 40)");
console.log("Ingested roles with usable JD (>200 chars):", withUsableJd, "  (Stage 17.1 needs ~30-100)");
