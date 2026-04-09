# Decision: Goal snapshots own canonical planning state

## Metadata

- updated_at: `2026-04-06T03:20:33+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-13T03:20:33+09:00`
- supersedes: `none`
- evidence_quality: `derived`

## Decision

- When goal snapshots exist, Goal is a projection and edits must flow through onboarding intake instead of direct workspace editing.

## Why It Stands

- This prevents dual-source drift between freeform Goal fields and the canonical planning snapshots.

## Operational Consequence

- New planning work should write GoalSpecSnapshot and CurrentStateSnapshot at final save, and snapshot-backed goals should redirect edits back to onboarding.

## Source Refs

- `components/pages/onboarding-intake-page-client.tsx#OnboardingIntakeFlow`
- `components/pages/intake-page-client.tsx#snapshot-backed guard`
- `lib/quest-agent/transitions.ts#saveGoalInState`
