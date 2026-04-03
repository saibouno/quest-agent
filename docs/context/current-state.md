# Current State

## Metadata

- updated_at: `2026-04-04T02:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-11T02:00:00+09:00`
- supersedes: `none`
- evidence_quality: `direct`
- source_refs:
  - `AGENTS.md#Read Order`
  - `README.md#Dependency Security`
  - `docs/runbooks/durable-context-promotion.md#Auto Promotion Contract`
  - `docs/runbooks/dependency-security.md#Baseline Controls`
  - `.github/workflows/dependency-security.yml`
  - `scripts/promote-durable-context.mjs#promoteDurableContext`
  - `scripts/dependency-guardrails.mjs`

## Product Shape

- Quest Agent is still one product from the outside, with onboarding at `/onboarding/intake` and `/onboarding/map`, daily execution at `/today`, resumption and goal management at `/portfolio`, and weekly reflection at `/review`.
- The v0.2 five-role scaffold remains an internal prompt-and-orchestration boundary, not a user-facing multi-agent surface.
- Product and architecture truth still lives in `docs/`, while deterministic runtime/state rules still live in `lib/quest-agent/`.

## Current Focus

- The repo now pairs a GitHub-centered dependency security baseline with scaffold-closeout durable-context auto-promotion.
- Dependency monitoring is expected to happen through GitHub repo settings, Dependabot update PRs, and the `Dependency Security` workflow rather than ad hoc local-only checks.
- `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` now auto-promotes the smallest durable delta into `docs/context/*` before it records `closeout_ready`.

## Blocked Work

- Active blocked plan: `none`
- Blocker summary: none promoted right now.
- Resume condition: No blocked work is recorded right now.

## Fallback Focus

- Prefer normal feature and repo-hygiene work while GitHub continues to own dependency detection, notification, and update PR generation.
- Keep using the repo-local harness closeout flow so canonical durable context stays aligned automatically.

## Recent Confirmed Decisions

- `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` auto-promotes the smallest durable delta into `docs/context/*`, and `closeout_ready` waits for `context_promotion_state = applied | noop`.
- Windows-safe `:noprofile` verify/build spellings are the canonical command surface for this repo and should stay aligned across docs, harness state, and closeout.
- Nested worktree tooling should resolve the canonical repo root through git common-dir first and prefer checkout-local `node_modules` before falling back to the canonical install.
- Generated harness artifacts under `output/theme_ops/` remain scratch-only evidence, not canonical current-state owners.
- Dependency security stays GitHub-centered for this repo: repo settings provide detection coverage, Dependabot owns recurring update PRs, and humans still review and merge.
- The merge gate for dependency risk stays scoped to runtime `high` and `critical` audit findings so dev-only churn does not permanently jam `main`.
- Any new or changed install-script package requires an allowlist update with a reason in the same PR before it can land.

## Next Safe Themes

- Dependency maintenance work that clears the current moderate runtime Next.js advisory without widening the merge gate.
- Durable-context and runbook follow-ups that stay within `docs/context/*`, harness docs, and related contract tests.
- Normal product and repo-hygiene work that assumes `npm.cmd run security:verify:noprofile` is the local dependency-security baseline.
