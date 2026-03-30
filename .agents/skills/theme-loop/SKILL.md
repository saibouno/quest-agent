---
name: theme-loop
description: Use when a Quest Agent implementation theme should follow the repo's deterministic local loop for plan scaffolding, self-review, status tracking, saved-check verification, and closeout draft generation before normal closeout.
---

# Theme Loop

This is the canonical skill for the minimal harnessed theme loop in `quest-agent`.

## Source Of Truth

- `workflows/HARNESSED_THEME_WORKFLOW.md`
- `docs/runbooks/theme-loop/PLAN_TEMPLATE.md`
- `docs/runbooks/theme-loop/REVIEW_CHECKLIST.md`
- `docs/runbooks/theme-loop/STATUS_TEMPLATE.md`
- `docs/runbooks/theme-loop/CLOSEOUT_TEMPLATE.md`
- `docs/runbooks/theme-loop/IMPLEMENT_RUNBOOK.md`

## Responsibilities

- Read the canonical theme brief created by `node scripts/theme-ops.mjs start`.
- Use `PLAN_TEMPLATE.md` to scaffold a draft plan.
- Use `REVIEW_CHECKLIST.md` to run deterministic self-review.
- If review findings remain, revise the plan before implementation.
- Move the harness state into `implementing` only after the plan is reviewed.
- Run saved verification commands through `node scripts/theme-harness.mjs verify`.
- Record `node scripts/theme-ops.mjs aftercare` and `node scripts/theme-ops.mjs explain`.
- Use `CLOSEOUT_TEMPLATE.md` to scaffold the closeout draft before `node scripts/theme-ops.mjs close`.

## Command Owners

- Worktree-owned:
  - implementation edits and repo-local tests
  - `node scripts/theme-harness.mjs scaffold-plan --slug "<slug>"`
  - `node scripts/theme-harness.mjs review-plan --slug "<slug>"`
  - `node scripts/theme-harness.mjs set-status --slug "<slug>" --to implementing|blocked`
  - `node scripts/theme-harness.mjs verify --slug "<slug>"`
  - `node scripts/theme-harness.mjs scaffold-closeout --slug "<slug>"`
- Root-owned:
- `node scripts/theme-ops.mjs start ... --merge-policy manual|auto_after_green --rollback-class manual|simple_revert`
  - `node scripts/theme-ops.mjs setup --slug "<slug>"`
  - `node scripts/theme-ops.mjs aftercare --slug "<slug>" ...`
  - `node scripts/theme-ops.mjs explain --slug "<slug>" ...`
  - `node scripts/theme-ops.mjs close --slug "<slug>"`
- Read-only:
  - `node scripts/theme-ops.mjs status --slug "<slug>"` may run from the theme worktree, but it should report the canonical repo root and the same owner boundary.

## Command Order

1. `node scripts/theme-ops.mjs start ...`
2. fill `output/theme_ops/<slug>-brief.md` with the confirmed brief and remove the stub sentinel
3. `node scripts/theme-harness.mjs scaffold-plan --slug "<slug>"`
4. `node scripts/theme-harness.mjs review-plan --slug "<slug>"`
5. `node scripts/theme-harness.mjs set-status --slug "<slug>" --to implementing`
6. implement
7. `node scripts/theme-harness.mjs verify --slug "<slug>"`
8. from the root repo checkout, run `node scripts/theme-ops.mjs aftercare --slug "<slug>" ...`
9. from the root repo checkout, run `node scripts/theme-ops.mjs explain --slug "<slug>" ...`
10. `node scripts/theme-harness.mjs scaffold-closeout --slug "<slug>"`
11. from the root repo checkout, run `node scripts/theme-ops.mjs close --slug "<slug>"`
   - Use `--wait-for-merge` when `merge_policy=auto_after_green` and the merge gate is ready.

## Repo Reality

- `theme-ops.mjs` also owns the routine-lane `merge_gate_*` payload and the eligible local `--wait-for-merge` merge-and-cleanup path.
- `theme-harness.mjs` owns only plan, review, workflow status, verification, and closeout draft artifacts.
- `review-plan` is a first-class standard step in the default harness route.
- `approved` and `rejected` remain human-only workflow states.
- Standard verification reality is `npm.cmd run harness:test:noprofile`, `npm.cmd run lint:noprofile`, `npm.cmd run typecheck:noprofile`, `npm.cmd run build:noprofile`, and `npm.cmd run guardrails:noprofile`.
- Generated runtime artifacts stay scratch-only under `output/theme_ops/`.
