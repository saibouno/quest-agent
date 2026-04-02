# Decision: Nested Worktree Root And Tooling Resolution

## Metadata

- updated_at: `2026-04-02T00:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-09T00:00:00+09:00`
- supersedes: `none`
- evidence_quality: `mixed`

## Decision

- Worktree-aware harness tooling resolves the canonical repo root through `git rev-parse --path-format=absolute --git-common-dir` first and falls back to filesystem gitdir parsing only when needed.
- Tooling resolution prefers checkout-local `node_modules` when present and otherwise falls back to the canonical repo root install.

## Why It Stands

- The 2026-04-01 `quest-agent-nested-worktree-build-followup-v1` theme recorded this policy as the stabilizing fix for nested worktree verification.
- The shared resolver and its tests in `scripts/theme-harness-lib.mjs` and `tests/theme-harness.test.mjs` now encode that behavior directly.

## Operational Consequence

- Future worktree-aware scripts should reuse the same canonical-root and tooling-root rules instead of reintroducing outer-root lockfile inference or ad hoc path guessing.
- When nested worktree verification regresses, compare behavior against this resolver policy before adding new one-off path logic.

## Source Refs

- `scripts/theme-harness-lib.mjs#resolveCheckoutRoots`
- `tests/theme-harness.test.mjs#resolveCheckoutRoots`
- `output/theme_ops/quest-agent-nested-worktree-build-followup-v1.json`
