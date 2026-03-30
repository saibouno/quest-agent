# Implement Runbook

Use this runbook when a theme should follow the minimal harness loop.

## Command Owners

- Worktree-owned:
  - implementation edits and repo-local tests
  - `node scripts/theme-harness.mjs scaffold-plan --slug <slug>`
  - `node scripts/theme-harness.mjs review-plan --slug <slug>`
  - `node scripts/theme-harness.mjs set-status --slug <slug> --to implementing|blocked`
  - `node scripts/theme-harness.mjs verify --slug <slug>`
  - `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>`
- Root-owned:
  - `node scripts/theme-ops.mjs start ...`
  - `node scripts/theme-ops.mjs setup --slug <slug>`
  - `node scripts/theme-ops.mjs aftercare --slug <slug> ...`
  - `node scripts/theme-ops.mjs explain --slug <slug> ...`
  - `node scripts/theme-ops.mjs close --slug <slug>`
- Read-only:
  - `node scripts/theme-ops.mjs status --slug <slug>` may run from the theme worktree, but it should report the canonical repo root and the owner boundary above.

## Standard Order

1. `node scripts/theme-ops.mjs start ...`
   - Pick `--merge-policy manual|auto_after_green` and `--rollback-class manual|simple_revert` at theme start.
2. if this is an existing pre-adoption theme state, run `node scripts/theme-ops.mjs setup --slug <slug>` from the root checkout to refresh explicit harness guidance metadata
3. fill `output/theme_ops/<slug>-brief.md` with the confirmed brief and remove the stub sentinel
4. `node scripts/theme-harness.mjs scaffold-plan --slug <slug>`
5. `node scripts/theme-harness.mjs review-plan --slug <slug>`
6. `node scripts/theme-harness.mjs set-status --slug <slug> --to implementing`
7. implement the confirmed plan
8. `node scripts/theme-harness.mjs verify --slug <slug>`
9. from the root repo checkout, run `node scripts/theme-ops.mjs aftercare --slug <slug> ...`
10. from the root repo checkout, run `node scripts/theme-ops.mjs explain --slug <slug> ...`
11. `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>`
12. from the root repo checkout, run `node scripts/theme-ops.mjs close --slug <slug>`
   - `merge_policy=manual` keeps the existing human merge checkpoint.
   - `merge_policy=auto_after_green` should use `node scripts/theme-ops.mjs close --slug <slug> --wait-for-merge` once the merge gate is ready.

## Verification Reality

- Save deterministic check commands through `theme-ops.mjs start --check-cmd ...`.
- Standard deterministic checks in this repo are:
  - `npm.cmd run harness:test:noprofile`
  - `npm.cmd run lint:noprofile`
  - `npm.cmd run typecheck:noprofile`
  - `npm.cmd run build:noprofile`
  - `npm.cmd run guardrails:noprofile`
- `build:noprofile` is the canonical Windows-safe build spelling for this repo's harness loop.

## Human-Only States

- `approved` and `rejected` remain workflow states.
- v1 does not let `theme-harness.mjs set-status` write them.
- Treat them as human-only boundaries handled after closeout draft and before merge decisions.

## Soft Default Boundary

- New normal themes use this harness route by default.
- `discard`, `remote_only_reference`, explicit exempt themes, and legacy themes should not be shown as active default themes.
- `auto_after_green` is only for bounded routine themes and requires `rollback_class=simple_revert`.
- `close` keeps the manual lane as a readiness command and lets the routine lane finish eligible local merge-and-cleanup work with `--wait-for-merge`.
