import assert from "node:assert/strict";
import { parseGreenhouse, parseLever, parseAdzuna } from "@/lib/ingest/sources";

// Greenhouse: { jobs: [{ id, title, absolute_url, location:{name}, content, company_name }] }
const gh = parseGreenhouse(
  { jobs: [{ id: 11, title: "Senior Product Manager", absolute_url: "https://x/11", location: { name: "Remote" }, content: "&lt;p&gt;Own the roadmap.&lt;/p&gt;", company_name: "Acme" }] },
  "fallback"
);
assert.equal(gh.length, 1);
assert.equal(gh[0].source, "greenhouse");
assert.equal(gh[0].external_id, "11");
assert.equal(gh[0].company, "Acme"); // prefers company_name over fallback
assert.equal(gh[0].apply_url, "https://x/11");
assert.ok(!gh[0].jd_text.includes("<p>"), "HTML tags stripped");
assert.ok(gh[0].jd_text.includes("Own the roadmap"));

// Greenhouse without company_name → uses the passed company.
const gh2 = parseGreenhouse(
  { jobs: [{ id: 12, title: "Product Manager", absolute_url: "https://x/12", location: null, content: "x" }] },
  "Beta"
);
assert.equal(gh2[0].company, "Beta");

// Lever: [{ id, text, hostedUrl, categories:{location}, descriptionPlain }]
const lv = parseLever(
  [{ id: "abc", text: "Product Manager", hostedUrl: "https://l/abc", categories: { location: "Bengaluru" }, descriptionPlain: "Define what to build." }],
  "Gamma"
);
assert.equal(lv[0].source, "lever");
assert.equal(lv[0].external_id, "abc");
assert.equal(lv[0].location, "Bengaluru");

// Adzuna: { results: [{ id, title, redirect_url, location:{display_name}, description, company:{display_name} }] }
const az = parseAdzuna({
  results: [{ id: "99", title: "Group Product Manager", redirect_url: "https://a/99", location: { display_name: "Mumbai" }, description: "Own discovery.", company: { display_name: "Delta" } }],
});
assert.equal(az[0].source, "adzuna");
assert.equal(az[0].company, "Delta");
assert.equal(az[0].apply_url, "https://a/99");

console.log("sources: all assertions passed");
