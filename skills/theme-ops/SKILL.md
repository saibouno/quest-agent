---
name: theme-ops
description: Use when starting, inspecting, or closing a Quest Agent implementation theme so the repo-local harness state and owner boundaries stay consistent with the canonical theme loop.
---

# Theme Ops

Use this thin entry when a Quest Agent theme needs the repo-local harness workflow.

## Canonical Skill

- The canonical harness skill is `.agents/skills/theme-loop/SKILL.md`.
- Use it for the full `plan -> review-plan -> implementation -> verification -> closeout` loop.

## Root-Owned Commands

- `node scripts/theme-ops.mjs start ... --merge-policy manual|auto_after_green --rollback-class manual|simple_revert`
- `node scripts/theme-ops.mjs setup --slug "<slug>"`
- `node scripts/theme-ops.mjs status --slug "<slug>"`
- `node scripts/theme-ops.mjs aftercare --slug "<slug>" ...`
- `node scripts/theme-ops.mjs explain --slug "<slug>" ...`
- `node scripts/theme-ops.mjs close --slug "<slug>" [--wait-for-merge]`

## Worktree-Owned Commands

- `node scripts/theme-harness.mjs scaffold-plan --slug "<slug>"`
- `node scripts/theme-harness.mjs review-plan --slug "<slug>"`
- `node scripts/theme-harness.mjs set-status --slug "<slug>" --to implementing|blocked`
- `node scripts/theme-harness.mjs verify --slug "<slug>"`
- `node scripts/theme-harness.mjs scaffold-closeout --slug "<slug>"`
