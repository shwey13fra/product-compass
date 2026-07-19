# Matching Findings — template

**Rule:** this doc *proposes*. Weights are never auto-changed. The product owner
decides; only an approved change ships, behind a flag so old vs new ranking can be
compared (Stage 18.4).

Source data: `/admin/matching` (the `admin_matching_report()` RPC over `applied` /
`role_viewed` / `onboarding_completed` events). Fill this in once real traffic exists —
do **not** draw conclusions from a near-empty report.

---

## Snapshot
- Date:
- Total applications in window:
- Data caveats (e.g. external applies are click-intent not confirmed; sparse N):

## The three numbers
| Metric | Observed | N | Notes |
|---|---|---|---|
| % applications from Top matches | | | vs View-all / direct |
| Avg rank of applied roles | | | lower = applied higher-ranked |
| Archetype match rate | | | applied archetype vs stated preference |

## Current ranking weights
_From `src/lib/preferences.ts` (`scoreRole`) — record the live values here:_
- W_ARCHETYPE:
- location / work-mode:
- real_pm_score contribution:
- (others)

## Hypothesis
_What we believed the ranking would produce (e.g. "most applications come from Top
matches; applied roles cluster in the top 5 ranks")._

## Observed behavior
_What the data actually shows vs the hypothesis. Be specific about N and confounders._

## Proposed weight change (ONE, if the data supports it)
- Change:
- Rationale (tie directly to observed behavior):
- Expected effect:
- Flag name (for A/B of old vs new ranking):
- **Decision (product owner): ⬜ approved  ⬜ rejected  ⬜ needs more data**

---
_Do not implement any change until the box above is checked "approved"._
