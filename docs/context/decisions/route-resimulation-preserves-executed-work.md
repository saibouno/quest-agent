# Decision: Route resimulation preserves executed work

## Metadata

- updated_at: `2026-04-06T03:20:33+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-13T03:20:33+09:00`
- supersedes: `none`
- evidence_quality: `derived`

## Decision

- Route resimulation should preserve completed, in-progress, and blocked execution records and replace only future planned work.

## Why It Stands

- Review-driven rerouting needs to keep execution history and active work intact while changing the remaining path.

## Operational Consequence

- Map replacement with preserveProgress keeps completed and active records, appends a newly simulated future route, and records a fresh RouteCommitment.

## Source Refs

- `components/pages/map-page-client.tsx#NavigatorMapPageClient`
- `components/pages/review-page-client.tsx#Route Fitness`
- `lib/quest-agent/transitions.ts#mergeMapRecordsWithProgress`
