---
name: context-promotion
description: Use when a Quest Agent theme closeout needs to promote durable delta into the canonical docs/context surface before scaffold-closeout.
---

# Context Promotion

Use this skill after theme `aftercare` and `explain`, and before scaffolded closeout.

## Source Of Truth

- `docs/runbooks/durable-context-promotion.md`
- `docs/context/adapter.json`

## Operation

- Read the promotion runbook first.
- Update the smallest necessary canonical artifacts under `docs/context/*`.
- Stop if there is no durable delta to promote.
- Return to the normal closeout flow after the promotion check is complete.
