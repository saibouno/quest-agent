# Current State

## Metadata

- updated_at: `2026-04-04T00:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-11T00:00:00+09:00`
- supersedes: `none`
- evidence_quality: `direct`
- source_refs:
  - `AGENTS.md#Read Order`
  - `README.md#Current flow`
  - `README.md#Dependency Security`
  - `.github/dependabot.yml`
  - `.github/workflows/dependency-security.yml`
  - `scripts/dependency-guardrails.mjs`
  - `docs/runbooks/dependency-security.md`

## Product Shape

- Quest Agent is still one product from the outside, with onboarding at `/onboarding/intake` and `/onboarding/map`, daily execution at `/today`, resumption and goal management at `/portfolio`, and weekly reflection at `/review`.
- The v0.2 five-role scaffold remains an internal prompt-and-orchestration boundary, not a user-facing multi-agent surface.
- Product and architecture truth still lives in `docs/`, while deterministic runtime/state rules still live in `lib/quest-agent/`.

## Current Focus

- The repo now carries a GitHub-centered dependency security baseline alongside the existing durable-context and harness workflow.
- Dependency monitoring is expected to happen through GitHub repo settings, Dependabot update PRs, and the `Dependency Security` workflow rather than ad hoc local-only checks.
- Install-script changes are now an explicit review surface through `scripts/dependency-guardrails.mjs` and `scripts/dependency-guardrails-allowlist.json`.

## Blocked Work

- No repo-local code blocker remains for the dependency security baseline after verification moved through a non-nested main-based checkout.
- The remaining completion dependency is repository-admin access to confirm `Dependency graph`, `Dependabot alerts`, `Dependabot security updates`, and `Dependabot malware alerts` in GitHub settings when the implementer cannot toggle them directly.

## Fallback Focus

- Prefer normal feature and repo-hygiene work while GitHub continues to own dependency detection, notification, and update PR generation.
- If GitHub settings cannot be changed in-thread, treat the repo settings checklist in `docs/runbooks/dependency-security.md` as the manual follow-up instead of weakening the code-side gate.

## Recent Confirmed Decisions

- Windows-safe `:noprofile` verify/build spellings are the canonical command surface for this repo and should stay aligned across docs, harness state, and closeout.
- Nested worktree tooling should resolve the canonical repo root through git common-dir first and prefer checkout-local `node_modules` before falling back to the canonical install.
- Generated harness artifacts under `output/theme_ops/` remain scratch-only evidence, not canonical current-state owners.
- Dependency security stays GitHub-centered for this repo: repo settings provide detection coverage, Dependabot owns recurring update PRs, and humans still review and merge.
- The merge gate for dependency risk stays scoped to runtime `high` and `critical` audit findings so dev-only churn does not permanently jam `main`.
- Any new or changed install-script package requires an allowlist update with a reason in the same PR before it can land.

## Next Safe Themes

- Dependency maintenance work that clears the current moderate runtime Next.js advisory without widening the merge gate.
- Normal product and repo-hygiene work that assumes `npm.cmd run security:verify:noprofile` is the local dependency-security baseline.
- Future automation or reporting themes can build on the GitHub-native monitoring baseline instead of replacing it with a separate manual process.
