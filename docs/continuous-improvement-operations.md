# Continuous Improvement Operations

## Goal
Keep one lightweight preview for change checks and one stable preview for daily dogfooding, without mixing their persistence contracts.

This document covers Quest Agent-specific preview, persistence, backup, and rollback operations.
Shared Codex workflow lives in `C:\Users\oatyu\.codex\AGENTS.md`.
Repo-specific workflow overrides live in `AGENTS.md`.

## Environment roles
- `main`
  - Integration source of truth for implementation changes
- `preview/demo`
  - Preview for lightweight change checks
  - Runs without Supabase
  - Uses browser `localStorage` on Vercel
  - Saved data is disposable
- `preview/dogfood`
  - Stable preview for continuous daily use
  - Keeps pointing at the same Supabase project across deploys
  - Saved data is treated as persistent working state

This plan does not delete or repurpose the operational `release` branch.
It only defines how Quest Agent moves work through `main`, `preview/demo`, and `preview/dogfood`.

## Environment contract
### `preview/demo`
- `QUEST_AGENT_DEPLOYMENT_TARGET=preview/demo`
- no `SUPABASE_URL`
- no `SUPABASE_SERVICE_ROLE_KEY`
- expected runtime storage: `browser-local`

### `preview/dogfood`
- `QUEST_AGENT_DEPLOYMENT_TARGET=preview/dogfood`
- set `SUPABASE_URL`
- set `SUPABASE_SERVICE_ROLE_KEY` in server env only
- set `SUPABASE_DB_URL` for dump and restore tooling
- set `QUEST_AGENT_EXPECTED_SUPABASE_URL` to the same value as `SUPABASE_URL`
- set `QUEST_AGENT_BACKUP_ROOT` to the directory where dogfood backups and manifests should be written
- expected runtime storage: `server-backed`

### Future client-side Supabase
- only `NEXT_PUBLIC_SUPABASE_URL`
- only `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- never expose `SUPABASE_SERVICE_ROLE_KEY` to the client bundle

## Local install and check baseline

- Use `npm.cmd ci` before local verification, CI, or promotion automation work so dependency state comes from the committed lockfile.
- Use `npm.cmd install` only when you intentionally want to add/update dependencies or rewrite `package-lock.json`.
- Use `npm.cmd run verify:noprofile` for the repo's baseline non-build check pass, then layer the remaining required checks on top when the theme demands them.

## Benchmark adapter shell

- Quest Agent exposes only an adapter-only benchmark shell in v1.1.
- `node scripts/theme-harness.mjs benchmark-scaffold --pack-id <id> [--out <path>] [--force]` writes tracked packs under `config/harness_benchmark_packs/`.
- `node scripts/theme-harness.mjs benchmark-validate --pack <path>` validates the shared contract and returns a canonical pack hash from the normalized pack object.
- `node scripts/theme-harness.mjs benchmark-run --pack <path>` is intentionally non-runnable in this repo and returns `status: "action_required"` with `execution_capability: "adapter_shell_only"`.
- This adapter shell is separate from preview promotion, closeout, and durable-context auto-promotion. It must not change `theme-ops.mjs close` semantics or create runtime artifacts under `output/theme_ops/benchmark/` in this delivery.

## Promotion flow
1. Land implementation changes in `main` first.
2. Reflect `main` into `preview/demo` for lightweight validation.
3. Promote only confirmed changes from `preview/demo` into `preview/dogfood`.
4. Do not develop directly on `preview/demo` or `preview/dogfood`.

Before promoting into `preview/dogfood`, confirm at least:
- `today`
- `park`
- `resume`
- `return`
- `review`

## Guardrails
### Supabase target pin
- Do not change the `preview/dogfood` Supabase target casually.
- `QUEST_AGENT_EXPECTED_SUPABASE_URL` must match `SUPABASE_URL`.
- Any real switch to a new Supabase project must be treated as an explicit migration.

### Browser-local ban on dogfood
- `preview/dogfood` must not run with `browser-local`.
- If Supabase env is missing, the app should fail fast instead of silently falling back.

### Service role server-only
- `SUPABASE_SERVICE_ROLE_KEY` is only for server runtime and server store access.
- `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` is forbidden.

### Destructive schema changes
- Do not promote destructive schema changes to `preview/dogfood` without backup and rollback.
- Any change that would make old data unreadable needs a migration path.
- If rollback steps are unclear, do not ship the change to dogfood.

## Learning capture
When dogfooding reveals something worth keeping, record it in one of these buckets:
- `bug`
- `friction`
- `misdiagnosis`
- `good intervention`
- `feature request`

It is fine if a single use session produces no note.
When something is worth keeping, use one of the buckets above so later review stays sortable.
In-product, the weekly Review form can attach one optional learning bucket to the saved note.

## Schema change runbook
Keep schema changes short and reversible.

### Before deploy
- capture a backup or export from the current dogfood Supabase project
- run `npm.cmd run guardrails:noprofile`
- run `npm.cmd run dogfood:backup:noprofile`
- run `npm.cmd run dogfood:restore:check:noprofile`
- write the intended schema change and the rollback plan in the same note
- identify whether the change is additive, destructive, or requires data migration

### Deploy
- apply the schema change
- deploy the app version that knows how to read and write the new shape

### Smoke test
- verify `today` still loads
- verify `park`, `resume`, `return`, and `review` still work
- verify existing goals, focus state, resume queue, and saved reviews remain readable
- verify the app shows `preview/dogfood` and `server-backed` in the environment pills

### Rollback conditions
- the app cannot load existing dogfood data
- `today`, `park`, `resume`, `return`, or `review` regresses
- the environment no longer stays `server-backed`

### Rollback action
- redeploy the previous stable commit
- restore the backed-up schema/data with `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dogfood-restore.ps1 -Apply`
- stop promotion work until the migration path is clarified

## Dogfood helper contract

The dogfood helper scripts are expected to fail fast and print a short summary that is easy to read in CI and in a terminal.

### Required environment
- `SUPABASE_URL`
- `SUPABASE_DB_URL`
- `QUEST_AGENT_EXPECTED_SUPABASE_URL`
- `QUEST_AGENT_BACKUP_ROOT`

### Backup output
- `scripts/dogfood-backup.ps1` writes a timestamped `.sql` dump plus a matching `.manifest.json`
- the manifest records the live row counts for the critical tables at backup time
- the backup step exits non-zero if the required env is missing or the dump command fails
- the helper uses `pg_dump` for the dump and `psql` for the counts snapshot

### Restore-check output
- `scripts/dogfood-restore-check.ps1` reads the latest manifest from the backup root by default
- the restore-check step exits non-zero if the required env is missing, the manifest is missing, the backup artifact is missing, or any critical table count differs
- success means the helper compared the manifest and live counts without mismatch and printed a one-line summary
- the helper uses `psql` to read the live counts and compares them to the manifest snapshot

### What counts as success
- the docs and script exit behavior agree
- the required env is explicit
- rollback criteria are still the same: if the current dogfood data cannot be read back safely, stop promotion until the migration path is clarified
