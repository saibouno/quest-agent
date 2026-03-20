# Vercel Preview Runbook

## Goal
Publish Quest Agent in two stable Vercel preview surfaces:

- `preview/demo` for lightweight change checks
- `preview/dogfood` for continuous internal use

## Environment split
### `preview/demo`
This is the disposable preview surface.
If Supabase is not connected, saved data is stored only in the current browser using `localStorage`.
That means:

- it survives reload in the same browser
- it does not sync across devices
- it is not shared with other people
- deploys do not guarantee preserved records

### `preview/dogfood`
This is the persistent preview surface.
It must stay connected to the same Supabase project across deploys.
If Supabase env is missing or the pinned target changes unexpectedly, the app should fail fast instead of falling back.

## Why the split exists
Vercel preview environments should not rely on local file writes.
Quest Agent therefore uses browser `localStorage` only for `preview/demo`.
`preview/dogfood` is reserved for stable server-backed usage.

## Recommended branch and project setup
- keep `main` as the integration branch
- keep `preview/demo` and `preview/dogfood` as promotion branches
- do not develop directly on `preview/demo` or `preview/dogfood`
- use separate Vercel projects for demo and dogfood

## Suggested Vercel setup
### Demo project
1. Open Vercel and choose "Add New Project".
2. Import `saibouno/quest-agent` from GitHub.
3. Let Vercel detect Next.js automatically.
4. Set `QUEST_AGENT_DEPLOYMENT_TARGET=preview/demo`.
5. Do not add `SUPABASE_URL`.
6. Do not add `SUPABASE_SERVICE_ROLE_KEY`.

### Dogfood project
1. Create a separate Vercel project for the same repository.
2. Set `QUEST_AGENT_DEPLOYMENT_TARGET=preview/dogfood`.
3. Set `SUPABASE_URL`.
4. Set `SUPABASE_SERVICE_ROLE_KEY` as a server env only.
5. Set `SUPABASE_DB_URL` for backup and restore operations.
6. Set `QUEST_AGENT_EXPECTED_SUPABASE_URL` to the same value as `SUPABASE_URL`.
7. Keep its project, branch, and env configuration separate from the demo project.

## Environment variables
### Demo preview without backend
- `QUEST_AGENT_DEPLOYMENT_TARGET=preview/demo`
- no Supabase env required
- this runs in browser-local preview mode

### Dogfood preview with backend
- `QUEST_AGENT_DEPLOYMENT_TARGET=preview/dogfood`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `QUEST_AGENT_EXPECTED_SUPABASE_URL`
- `QUEST_AGENT_BACKUP_ROOT` optional, defaults to `./backups/dogfood`

### AI later
Add these when you want real model calls instead of heuristic fallback:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

### Future client-side Supabase
If a client-side Supabase feature is added later, limit it to:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in any `NEXT_PUBLIC_*` env.

## What non-engineers should know
- Vercel is the service that puts this web app on the internet.
- A preview URL is a temporary shareable link for checking the current build.
- `preview/demo` saves only in the browser you used.
- `preview/dogfood` is the place where data should survive deploys.

## Verification checklist
### Demo
After deployment, confirm:

- the app opens
- `/intake`, `/map`, `/today`, and `/review` all render
- creating a goal survives reload in the same browser
- creating a map, updating today's quests, and saving a review also survive reload

### Dogfood
After deployment, confirm:

- the app opens with `preview/dogfood` and `server-backed` visible in the environment pills
- goals, focus, resume queue, and saved reviews remain after deploy
- `today`, `park`, `resume`, `return`, and `review` still work
- demo env and dogfood env are not mixed
- `npm.cmd run dogfood:backup:noprofile` creates a backup bundle
- `npm.cmd run dogfood:restore:check:noprofile` restores that bundle into a scratch Postgres successfully

## Backup and rollback operations
- Run `npm.cmd run guardrails:noprofile` before any dogfood promotion or destructive schema change.
- Run `npm.cmd run dogfood:backup:noprofile` to create `roles.sql`, `schema.sql`, `data.sql`, and `manifest.json`.
- Run `npm.cmd run dogfood:restore:check:noprofile` to verify the backup against a scratch Postgres container.
- Use `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dogfood-restore.ps1` only for explicit rollback work.
- Add `-Apply` to the live restore command only when you intentionally want to overwrite the live dogfood database.

## What is not done by this runbook
- custom domain setup
- production launch
- shared persistence without Supabase
- authentication

For the full promotion flow, guardrails, and schema-change runbook, see `docs/continuous-improvement-operations.md`.
