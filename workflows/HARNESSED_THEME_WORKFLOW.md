# Harnessed Theme Workflow

## Purpose

- Reuse one deterministic repo-local loop for `plan -> review-plan -> implementation -> verification -> aftercare -> explain -> scaffold-closeout (auto-promotion) -> closeout`.
- Keep Quest Agent's local harness small and repo-owned in v1.
- Keep `scripts/theme-ops.mjs` as the owner of theme state bootstrap, read-only status, and root-owned aftercare / explain / close commands.
- Keep `scripts/theme-harness.mjs` as the owner of plan, review, workflow status, verification, and closeout draft artifacts.

## Source Of Truth

- `AGENTS.md`
- `README.md`
- `docs/runbooks/durable-context-promotion.md`
- `docs/runbooks/theme-loop/*`
- `.agents/skills/context-promotion/SKILL.md`
- `.agents/skills/theme-loop/SKILL.md`
- `scripts/theme-ops.mjs`
- `scripts/theme-harness.mjs`
- `scripts/harness-benchmark-lib.mjs`

## Workflow States

- `selected`
  - Conceptual state only.
  - The theme was selected, but no harness artifact exists yet.
  - The first `scaffold-plan` records `selected -> plan_drafted`.
- `plan_drafted`
  - A draft plan exists at `output/theme_ops/<slug>-plan.md`.
- `plan_reviewed`
  - A review artifact exists at `output/theme_ops/<slug>-review.md`.
  - `harness.review_results.result == pass`.
- `implementing`
  - The confirmed plan is being implemented.
- `verified`
  - Saved required checks ran and all passed.
- `closeout_ready`
  - A closeout draft exists and the closeout gates are satisfied.
- `approved`
  - Human-only terminal state.
  - `theme-harness.mjs set-status` must reject it.
- `rejected`
  - Human-only terminal state.
  - `theme-harness.mjs set-status` must reject it.
- `blocked`
  - Implementation or verification is waiting on a concrete blocker.

## Command Ownership

- Worktree-owned commands:
  - implementation edits and repo-local tests
  - `node scripts/theme-harness.mjs scaffold-plan --slug <slug>`
  - `node scripts/theme-harness.mjs review-plan --slug <slug>`
  - `node scripts/theme-harness.mjs set-status --slug <slug> --to implementing|blocked`
  - `node scripts/theme-harness.mjs verify --slug <slug>`
  - `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>`
  - `node scripts/theme-harness.mjs benchmark-scaffold --pack-id <id> [--out <path>] [--force]`
  - `node scripts/theme-harness.mjs benchmark-validate --pack <path>`
  - `node scripts/theme-harness.mjs benchmark-run --pack <path>`
- Root-owned commands:
  - `node scripts/theme-ops.mjs start ...`
  - `node scripts/theme-ops.mjs setup --slug <slug>`
  - `node scripts/theme-ops.mjs aftercare --slug <slug> ...`
  - `node scripts/theme-ops.mjs explain --slug <slug> ...`
  - `node scripts/theme-ops.mjs close --slug <slug>`
- Read-only:
  - `node scripts/theme-ops.mjs status --slug <slug>` may run from the root checkout or the theme worktree, but it must still report the canonical repo root and the owner boundary above.

## Command Behavior

- `node scripts/theme-ops.mjs start ...`
  - Creates the branch/worktree when missing.
  - Seeds `required_checks`, `harness_policy`, `merge_policy`, `rollback_class`, and the canonical brief stub at `output/theme_ops/<slug>-brief.md`.
  - Uses `default` as the soft default policy for new normal themes.
- `node scripts/theme-ops.mjs setup --slug <slug>`
  - Refreshes explicit `default`, `exempt`, and `legacy` guidance metadata without changing the real workflow progress.
- `node scripts/theme-ops.mjs status --slug <slug>`
  - Reports the canonical repo root, owner boundary, saved checks, current workflow status, `default` / `exempt` / `legacy` harness guidance, and the shared `merge_gate_*` payload.
  - Surfaces the shared `context_promotion_required`, `context_promotion_state`, `context_promotion_reason`, and `context_promotion_next_action` fields.
  - Uses guidance-only labels such as `not_started`, `not_applicable`, and `legacy` when no harness workflow state exists yet.
- `node scripts/theme-harness.mjs scaffold-plan --slug <slug>`
  - Uses the canonical `brief_path` from theme state when `--brief-path` is omitted.
  - Must stop with `action_required` while the brief stub sentinel is still present.
  - Generates the initial plan and status note.
  - Initializes the `harness` block and records `plan_drafted`.
- `node scripts/theme-harness.mjs review-plan --slug <slug>`
  - Runs deterministic structure review through the shared pure evaluator in `scripts/theme-harness-review-core.mjs`.
  - Writes `review_results` with stable `schema_version`, `checklist_results`, and `finding_codes`.
  - Requires explicit `Merge Policy`, `Rollback Class`, and `Publish / handoff boundary` lines in the generated plan summary.
  - The publish / handoff boundary must say whether the lane stops at local closeout + commit or continues through push / PR handling.
  - Records `plan_reviewed` only when findings are empty.
- `node scripts/theme-harness.mjs set-status --slug <slug> --to implementing|blocked`
  - Allows only:
    - `plan_reviewed -> implementing`
    - `implementing -> blocked`
    - `blocked -> implementing`
  - Must reject `approved`, `rejected`, `plan_reviewed`, `verified`, and `closeout_ready`.
- `node scripts/theme-harness.mjs verify --slug <slug>`
  - Runs saved `required_checks`.
  - Writes `validation_runs`.
  - Records `verified` only when every saved command passes.
  - If there are zero saved commands, records `blocked` with `missing_required_checks`.
- `node scripts/theme-ops.mjs aftercare --slug <slug> ...`
  - Records implementation aftercare in theme state.
  - Must run from the canonical repo root.
- `node scripts/theme-ops.mjs explain --slug <slug> ...`
  - Records the plain-language closeout summary in theme state.
  - Owns the structured durable delta captured for auto-promotion.
  - Must run from the canonical repo root.
- `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>`
  - Requires:
    - `workflow_status == verified`
    - `aftercare.checked_at`
    - `plain_language_summary.recorded_at`
  - Auto-runs durable-context promotion through `scripts/promote-durable-context.mjs`.
  - Records `closeout_ready` only after `context_promotion_state == applied | noop`.
  - Keeps the workflow at `verified` when durable-context promotion returns `blocked`.
  - Generates `output/theme_ops/<slug>-closeout.md` with required `Known Issues / Follow-ups` content and records `closeout_ready`.
- `node scripts/theme-ops.mjs close --slug <slug>`
  - Is the repo-local closeout owner in v1.
  - Must run from the canonical repo root.
  - `merge_policy=manual` keeps the existing human merge checkpoint.
  - `merge_policy=auto_after_green` uses `close --wait-for-merge` to finish the local merge-and-cleanup path once the shared merge gate is ready.

## Benchmark Adapter Shell

- `node scripts/theme-harness.mjs benchmark-scaffold --pack-id <id> [--out <path>] [--force]`
  - Writes tracked benchmark packs under `config/harness_benchmark_packs/`.
  - Rejects existing targets unless `--force` is provided.
  - Keeps the tracked pack surface prompt-only for the initial Quest Agent adapter shell.
- `node scripts/theme-harness.mjs benchmark-validate --pack <path>`
  - Validates the shared required top-level contract, rejects unknown top-level keys, enforces `extensions.quest-agent`, and rejects `mutable_paths` / `fixed_paths` overlap.
  - Returns a canonical `pack_hash` computed from the validated object so key order and newline differences do not change the hash.
- `node scripts/theme-harness.mjs benchmark-run --pack <path>`
  - Validates the pack, then stops with `status: "action_required"` and `execution_capability: "adapter_shell_only"`.
  - Must not create runtime artifacts under `output/theme_ops/benchmark/` in this delivery.
- These benchmark commands are adapter-only config helpers.
- They do not change workflow status, closeout readiness, durable-context auto-promotion, or `node scripts/theme-ops.mjs close --slug <slug>` semantics.

## Verification Reality

- Current standard verify commands in this repo are:
  - `npm.cmd run harness:test:noprofile`
  - `npm.cmd run lint:noprofile`
  - `npm.cmd run typecheck:noprofile`
  - `npm.cmd run build:noprofile`
  - `npm.cmd run guardrails:noprofile`
- `build:noprofile` is the canonical Windows-safe build spelling for the harness loop.

## Closeout Boundary

- v1 makes the harness the default route for new normal themes, but only as a soft default.
- `status` and `close` should still explain when a theme is `exempt` or `legacy`.
- Every confirmed brief and scaffolded plan must make the publish / handoff boundary explicit so local closeout is not confused with remote push / PR work.
- `status` and `close` expose the shared routine merge contract fields: `merge_policy`, `current_workflow_status`, `merge_gate_required`, `merge_gate_ready`, `merge_gate_reason`, and `merge_gate_next_action`.
- `status` and `close` also expose the shared durable-context fields: `context_promotion_required`, `context_promotion_state`, `context_promotion_reason`, and `context_promotion_next_action`.
- `approved` and `rejected` remain human-only workflow states.
- Durable-context promotion is repo-local to `explain -> scaffold-closeout` in v1, with `scripts/promote-durable-context.mjs` as the helper and troubleshooting entrypoint.
- Generated harness artifacts are scratch-only under `output/theme_ops/`.
