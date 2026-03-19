# Quest Agent Repo Guide

Start here when you need to understand or change the product.

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

## Working Rules
- External behavior stays as one Quest Agent.
- The 5 internal roles are scaffold only in v0.2.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- Vercel Preview without Supabase uses browser `localStorage`, not server file writes.
- `preview/dogfood` must stay `server-backed` and pinned to its intended Supabase URL.
- Use one mothership chat to assign themes, handoffs, and merge order.
- Default unit of work is `1 theme = 1 chat = 1 worktree`.
- Start each theme with: scope, out of scope, done condition, and expected end state (`merge_and_delete`, `remote_only_reference`, or `discard`).
- Treat `lib/quest-agent/types.ts`, `lib/quest-agent/transitions.ts`, `lib/quest-agent/server/store.ts`, `components/layout/app-shell.tsx`, and `app/page.tsx` as shared-core files that should not be edited in parallel.
- On this Windows workspace, prefer PowerShell without profile for automated commands. In Codex use `login:false`; in package scripts use the `*:noprofile` variants when available. This avoids profile-related `PSSecurityException` and intermittent `spawn EPERM` build failures.

## Git Workflow
- Default branch is `main`.
- Keep `origin/preview/demo`, `origin/preview/dogfood`, and `origin/release` as operational branches. Do not delete them as part of normal cleanup.
- For normal changes, work on a `codex/*` branch + worktree, verify the needed checks, then `commit` and `push`.
- Direct commits to `main` require explicit human approval.
- Create GitHub PRs in Japanese by default.
- Merge PRs into `main` with `Create a merge commit` unless there is a clear reason not to.
- After merge, delete the remote feature branch and delete the local feature branch.
- After merge, switch back to `main`, `fetch --prune`, and fast-forward local `main` to `origin/main`.
