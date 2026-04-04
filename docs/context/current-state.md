# Current State

## Metadata

- updated_at: `2026-04-04T02:59:42+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-11T02:59:42+09:00`
- supersedes: `none`
- evidence_quality: `mixed`
- source_refs:
  - `AGENTS.md#Read Order`
  - `README.md#Dependency Security`
  - `docs/runbooks/durable-context-promotion.md#Auto Promotion Contract`
  - `docs/runbooks/dependency-security.md#Baseline Controls`
  - `.github/workflows/dependency-security.yml`
  - `scripts/promote-durable-context.mjs#promoteDurableContext`
  - `scripts/dependency-guardrails.mjs`
  - `output/theme_ops/quest-agent-security-remediation-v1.json`
  - `package.json#dependencies/devDependencies/overrides`
  - `package-lock.json#packages`

## Product Shape

- Quest Agent is still one product from the outside, with onboarding at `/onboarding/intake` and `/onboarding/map`, daily execution at `/today`, resumption and goal management at `/portfolio`, and weekly reflection at `/review`.
- The v0.2 five-role scaffold remains an internal prompt-and-orchestration boundary, not a user-facing multi-agent surface.
- Product and architecture truth still lives in `docs/`, while deterministic runtime/state rules still live in `lib/quest-agent/`.

## Current Focus

- The repo now pairs a GitHub-centered dependency security baseline with scaffold-closeout durable-context auto-promotion.
- The current GitHub dependency alerts were cleared in `quest-agent-security-remediation-v1` from a root checkout without reopening the historical nested-worktree security lane.
- `next` and `eslint-config-next` now track `16.2.2`, and scoped overrides keep the remaining `flatted`, `brace-expansion`, and `picomatch` paths on fixed releases.

## Blocked Work

- Active blocked plan: `none`
- Blocker summary: none promoted right now.
- Resume condition: No blocked work is recorded right now.

## Fallback Focus

- Prefer normal feature and repo-hygiene work while GitHub owns dependency detection and recurring update PR generation.
- Handle dependency-only remediation and override cleanup in separate scoped themes instead of widening feature lanes.

## Recent Confirmed Decisions

- Dependency-only GitHub alert remediation should run in a new root-checkout theme instead of resuming the historical nested-worktree security lane.
- `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` auto-promotes the smallest durable delta into `docs/context/*`, and `closeout_ready` waits for `context_promotion_state = applied | noop`.
- Windows-safe `:noprofile` verify/build spellings are the canonical command surface for this repo and should stay aligned across docs, harness state, and closeout.
- Nested worktree tooling should resolve the canonical repo root through git common-dir first and prefer checkout-local `node_modules` before falling back to the canonical install.
- Generated harness artifacts under `output/theme_ops/` remain scratch-only evidence, not canonical current-state owners.
- Dependency security stays GitHub-centered for this repo: repo settings provide detection coverage, Dependabot owns recurring update PRs, and humans still review and merge.
- The merge gate for dependency risk stays scoped to runtime `high` and `critical` audit findings so dev-only churn does not permanently jam `main`.
- Any new or changed install-script package requires an allowlist update with a reason in the same PR before it can land.

## Next Safe Themes

- Dependency maintenance work that removes the temporary overrides once upstream trees absorb the fixed transitive releases.
- Durable-context and runbook follow-ups that stay within `docs/context/*`, harness docs, and related contract tests.
- Normal product and repo-hygiene work that assumes `npm.cmd run security:verify:noprofile` is the local dependency-security baseline.
