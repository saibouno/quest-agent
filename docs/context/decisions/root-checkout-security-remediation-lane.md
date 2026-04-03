# Decision: Root Checkout Security Remediation Lane

## Metadata

- updated_at: `2026-04-04T02:25:17+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-11T02:25:17+09:00`
- supersedes: `none`
- evidence_quality: `derived`

## Decision

- Dependency-only GitHub alert remediation should run in a new root-checkout theme instead of resuming the blocked nested-worktree quest-agent-security-baseline lane.

## Why It Stands

- The root-checkout remediation updated Next.js to 16.2.2, pinned the remaining vulnerable transitive paths through scoped overrides, cleared npm audit, and passed the standard verification commands without reopening the nested-worktree build failure.

## Operational Consequence

- Future dependency-only alert themes should start from the root checkout, keep scope to package metadata unless green verification needs a minimal fix, and treat quest-agent-security-baseline as historical blocker context rather than the lane to resume by default.

## Source Refs

- `package.json#dependencies/devDependencies/overrides`
- `package-lock.json#packages`
- `output/theme_ops/quest-agent-security-remediation-v1.json#harness.validation_runs`
