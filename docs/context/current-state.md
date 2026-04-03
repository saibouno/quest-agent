# Current State

## Metadata

- updated_at: `2026-04-04T00:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-11T00:00:00+09:00`
- supersedes: `none`
- evidence_quality: `mixed`
- source_refs:
  - `AGENTS.md#Read Order`
  - `README.md#Current flow`
  - `docs/runbooks/durable-context-promotion.md#Auto Promotion Contract`
  - `scripts/theme-ops.mjs#recordExplain,statusTheme,closeTheme`
  - `scripts/theme-harness.mjs#scaffoldCloseout`
  - `scripts/promote-durable-context.mjs#promoteDurableContext`
  - `output/theme_ops/quest-agent-security-baseline.json`

## Product Shape

- Quest Agent is still one product from the outside, with onboarding at `/onboarding/intake` and `/onboarding/map`, daily execution at `/today`, resumption and goal management at `/portfolio`, and weekly reflection at `/review`.
- The v0.2 five-role scaffold remains an internal prompt-and-orchestration boundary, not a user-facing multi-agent surface.
- Product and architecture truth still lives in `docs/`, while deterministic runtime/state rules still live in `lib/quest-agent/`.

## Current Focus

- The current GitHub dependency alerts are cleared in quest-agent-security-remediation-v1 from the root checkout without reopening the blocked nested-worktree quest-agent-security-baseline lane.
- next and eslint-config-next now track 16.2.2, and the lockfile uses targeted overrides to keep the remaining vulnerable flatted, brace-expansion, and picomatch paths on fixed releases.
- Root-checkout verification remains the safe remediation path on this Codex Windows setup because sandboxed harness verify can still require elevation to avoid cmd.exe EPERM.

## Blocked Work

- Active blocked plan: `none`
- Blocker summary: none promoted right now.
- Resume condition: Manual merge remains the only remaining checkpoint for the root-checkout remediation theme.

## Fallback Focus

- Dependency-only security follow-ups and harness verification hygiene that stay outside app runtime changes.

## Recent Confirmed Decisions

- Dependency-only GitHub alert remediation should run in a new root-checkout theme instead of resuming the blocked nested-worktree quest-agent-security-baseline lane.
- `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` auto-promotes the smallest durable delta into `docs/context/*`, and `closeout_ready` waits for `context_promotion_state = applied | noop`.
- Scaffolded closeout is now the repo-local owner of durable-context auto-promotion, and `closeout_ready` waits for `context_promotion_state = applied | noop`.
- Windows-safe `:noprofile` verify/build spellings are the canonical command surface for this repo and should stay aligned across docs, harness state, and closeout.
- Nested worktree tooling should resolve the canonical repo root through git common-dir first and prefer checkout-local `node_modules` before falling back to the canonical install.
- Generated harness artifacts under `output/theme_ops/` remain scratch-only evidence, not canonical current-state owners.

## Next Safe Themes

- A separate dependency-hygiene theme can remove the scoped overrides once upstream dependency trees absorb the fixed transitive releases.
- A workflow follow-up can target the remaining cmd.exe EPERM sandbox friction so root-checkout harness verify no longer needs elevation.
- Any broader security hardening or Supabase/tooling upgrades should stay in separate explicitly scoped themes.
