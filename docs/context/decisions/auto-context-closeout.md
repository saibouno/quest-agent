# Decision: Auto Context Closeout

## Metadata

- updated_at: `2026-04-04T01:41:03+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-11T01:41:03+09:00`
- supersedes: `none`
- evidence_quality: `mixed`

## Decision

- `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` auto-promotes the smallest durable delta into `docs/context/*`, and `closeout_ready` waits for `context_promotion_state = applied | noop`.

## Why It Stands

- This keeps canonical durable context aligned with closeout readiness while enforcing stale-write protection, deterministic owner mapping, and crash-safe writes in the repo-local helper.

## Operational Consequence

- Default harness themes should record structured durable input in `node scripts/theme-ops.mjs explain --slug <slug> ...` when needed, and blocked promotion keeps the workflow at `verified` until the remediation is handled.

## Source Refs

- `docs/runbooks/durable-context-promotion.md#Auto Promotion Contract`
- `scripts/theme-ops.mjs#recordExplain`
- `scripts/theme-harness.mjs#scaffoldCloseout`
- `scripts/promote-durable-context.mjs#promoteDurableContext`
