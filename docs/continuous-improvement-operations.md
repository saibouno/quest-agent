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
- optional `QUEST_AGENT_BACKUP_ROOT` to move backups outside the repo default
- expected runtime storage: `server-backed`

### Future client-side Supabase
- only `NEXT_PUBLIC_SUPABASE_URL`
- only `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- never expose `SUPABASE_SERVICE_ROLE_KEY` to the client bundle

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

## Dogfood promotion checklist
Use this checklist as the default promotion gate for `preview/dogfood`:

1. Confirm `preview/dogfood` env still uses the intended `SUPABASE_URL` and `QUEST_AGENT_EXPECTED_SUPABASE_URL`.
2. Run `npm.cmd run guardrails:noprofile`.
3. Run `npm.cmd run dogfood:backup:noprofile`.
4. Run `npm.cmd run dogfood:restore:check:noprofile`.
5. If the dogfood project is new or the schema changed, apply [schema.sql](/C:/Users/oatyu/.codex/worktrees/8242/quest-agent/supabase/schema.sql) in Supabase SQL Editor before redeploying.
6. Redeploy `preview/dogfood` on Vercel.
7. Verify `/today`, `/return`, and `/review`.
8. Create or edit one goal, reload, and confirm the data persists.
9. If rollback is needed, redeploy the previous stable commit and then run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dogfood-restore.ps1 -Apply`.

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
