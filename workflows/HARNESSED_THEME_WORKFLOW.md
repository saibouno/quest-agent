# Harnessed Theme Workflow

## Purpose

- Reuse one deterministic repo-local loop for `plan -> review-plan -> implementation -> verification -> closeout`.
- Keep Quest Agent's local harness small and repo-owned in v1.
- Keep `scripts/theme-ops.mjs` as the owner of theme state bootstrap, read-only status, and root-owned aftercare / explain / close commands.
- Keep `scripts/theme-harness.mjs` as the owner of plan, review, workflow status, verification, and closeout draft artifacts.

## Source Of Truth

- `AGENTS.md`
- `README.md`
- `docs/runbooks/theme-loop/*`
- `.agents/skills/theme-loop/SKILL.md`
- `scripts/theme-ops.mjs`
- `scripts/theme-harness.mjs`

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
  - Seeds `required_checks`, `harness_policy`, and the canonical brief stub at `output/theme_ops/<slug>-brief.md`.
  - Uses `default` as the soft default policy for new normal themes.
- `node scripts/theme-ops.mjs setup --slug <slug>`
  - Refreshes explicit `default`, `exempt`, and `legacy` guidance metadata without changing the real workflow progress.
- `node scripts/theme-ops.mjs status --slug <slug>`
  - Reports the canonical repo root, owner boundary, saved checks, current workflow status, and `default` / `exempt` / `legacy` harness guidance.
  - Uses guidance-only labels such as `not_started`, `not_applicable`, and `legacy` when no harness workflow state exists yet.
- `node scripts/theme-harness.mjs scaffold-plan --slug <slug>`
  - Uses the canonical `brief_path` from theme state when `--brief-path` is omitted.
  - Must stop with `action_required` while the brief stub sentinel is still present.
  - Generates the initial plan and status note.
  - Initializes the `harness` block and records `plan_drafted`.
- `node scripts/theme-harness.mjs review-plan --slug <slug>`
  - Runs deterministic structure review through the shared pure evaluator in `scripts/theme-harness-review-core.mjs`.
  - Writes `review_results` with stable `schema_version`, `checklist_results`, and `finding_codes`.
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
  - Must run from the canonical repo root.
- `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>`
  - Requires:
    - `workflow_status == verified`
    - `aftercare.checked_at`
    - `plain_language_summary.recorded_at`
  - Generates `output/theme_ops/<slug>-closeout.md` and records `closeout_ready`.
- `node scripts/theme-ops.mjs close --slug <slug>`
  - Is a local readiness and remediation command in v1.
  - Must run from the canonical repo root.
  - Does not commit, push, create PRs, merge, or clean up branches/worktrees in this version.
  - Does not hard-block `default` themes yet; it reports readiness and next actions instead.

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
- `approved` and `rejected` remain human-only workflow states.
- Generated harness artifacts are scratch-only under `output/theme_ops/`.
