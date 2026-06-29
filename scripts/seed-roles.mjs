// Dev seeding via the anon client. NOTE: this only works if RLS allows anon
// INSERT on `roles`. In this project RLS blocks anon writes, so prefer
// gen-seed-sql.mjs + running seed.sql in the Supabase SQL editor instead.
//
// Run with:  node scripts/seed-roles.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ROLES } from "./roles-data.mjs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
  console.log(`Seeding ${ROLES.length} roles…`);
  const del = await supabase.from("roles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (del.error) console.warn("Delete warning (continuing):", del.error.message);

  const { data, error } = await supabase.from("roles").insert(ROLES).select("id");
  if (error) {
    console.error("Insert failed:", error.message);
    console.error("If this is an RLS error, run seed.sql in the Supabase SQL editor instead.");
    process.exit(1);
  }
  console.log(`Inserted ${data.length} roles. ✅`);
}

main();
