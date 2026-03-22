# Quest Agent Repo Guide

This repo follows the shared Codex workflow in `C:\Users\oatyu\.codex\AGENTS.md`.
This file keeps Quest Agent-specific guidance and exceptions only.

## Read Order
1. `README.md`
2. `docs/v0_2-agent-architecture.md`
3. `docs/v0_2-role-io-contracts.md`
4. `docs/vercel-preview-runbook.md`
5. `docs/continuous-improvement-operations.md`

## Source Of Truth
- Product and architecture decisions live in `docs/`.
- Role prompts live in `prompts/`.
- Deterministic state, validation, and persistence rules live in `lib/quest-agent/`.

## Repo Rules
- External behavior stays as one Quest Agent.
- The 5 internal roles are scaffold only in v0.2.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- When touching OpenAI API integrations, use `openai-docs`, check the current official OpenAI docs before editing, and briefly note what you verified after the change.
- On this Windows workspace, prefer PowerShell without profile for automated commands. In Codex use `login:false`; in package scripts use the `*:noprofile` variants when available. This avoids profile-related `PSSecurityException` and intermittent `spawn EPERM` build failures.
- Create GitHub PRs in Japanese by default.

## Branch And Preview Rules
- Default branch is `main`.
- Keep `origin/preview/demo`, `origin/preview/dogfood`, and `origin/release` as operational branches. Do not delete them as part of normal cleanup.
- Vercel Preview without Supabase uses browser `localStorage`, not server file writes.
- `preview/dogfood` must stay `server-backed` and pinned to its intended Supabase URL.

## Protected / Shared-Core
- `lib/quest-agent/types.ts`
- `lib/quest-agent/transitions.ts`
- `lib/quest-agent/server/store.ts`
- `components/layout/app-shell.tsx`
- `app/page.tsx`

## Git Workflow
- Use `codex/*` branches for normal implementation changes, verify the needed repo checks, then `commit` and `push`.
- Merge PRs into `main` with `Create a merge commit` unless there is a clear reason not to.
- After merge, delete the remote feature branch and delete the local feature branch.
- After merge, switch back to `main`, `fetch --prune`, and fast-forward local `main` to `origin/main`.
