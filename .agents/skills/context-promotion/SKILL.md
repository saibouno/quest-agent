---
name: context-promotion
description: Use when a Quest Agent theme closeout needs to promote durable delta into the canonical docs/context surface before scaffold-closeout.
---

# Context Promotion

Use this skill after theme `aftercare` and `explain`, when scaffolded closeout needs to auto-promote canonical durable context.

## Source Of Truth

- `docs/runbooks/durable-context-promotion.md`
- `docs/context/adapter.json`

## Operation

- Read the promotion runbook first.
- Record structured durable input through `node scripts/theme-ops.mjs explain --slug <slug> ...` when the theme changes canonical durable context.
- Let `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` run the auto-promotion gate.
- Use `node scripts/promote-durable-context.mjs --slug <slug>` only for focused troubleshooting or verification.
- Stop if there is no durable delta to promote.
- Return to the normal closeout flow after scaffold-closeout finishes the promotion check.
