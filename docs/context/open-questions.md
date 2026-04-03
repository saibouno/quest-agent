# Open Questions And Blockers

## Metadata

- updated_at: `2026-04-02T00:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-09T00:00:00+09:00`
- supersedes: `none`
- evidence_quality: `mixed`

## Open Questions

- none promoted right now; the active unresolved item is the blocker below.

## Blockers

### `nested-worktree-prerender-invariant`

- id: `nested-worktree-prerender-invariant`
- observed_at: `2026-04-01T07:04:04.173Z`
- impact: `quest-agent-security-baseline` cannot clear `npm.cmd run build:noprofile` inside its nested worktree, so the active security lane cannot resume.
- next unlock: resolve the Next.js `/_not-found` prerender invariant in the nested worktree build, or redefine the verification lane onto a non-nested checkout path.
- last_verified_by: `quest-agent-security-baseline / npm.cmd run build:noprofile @ 2026-04-01T07:04:04.173Z`
- evidence_ref: `output/theme_ops/quest-agent-security-baseline.json#validation_runs[build:noprofile@2026-04-01T07:04:04.173Z]`

## Resolved / Superseded

- none promoted right now.
