# Open Questions And Blockers

## Metadata

- updated_at: `2026-04-04T02:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-11T02:00:00+09:00`
- supersedes: `none`
- evidence_quality: `direct`

## Open Questions

- none promoted right now.

## Blockers

- none promoted right now.

## Resolved / Superseded

### `github-repo-security-settings-access`

- id: `github-repo-security-settings-access`
- status: `resolved`
- resolved_at: `2026-04-04T02:00:00+09:00`
- summary: GitHub repository security settings were enabled and the dependency-security baseline PR passed green checks, so the external completion dependency is closed.
- source_refs:
  - `README.md#Dependency Security`
  - `.github/workflows/dependency-security.yml`

### `nested-worktree-prerender-invariant`

- id: `nested-worktree-prerender-invariant`
- status: `resolved`
- resolved_at: `2026-04-04T02:00:00+09:00`
- summary: The security baseline verification lane moved through a non-nested main-based checkout, so the prior nested-worktree build blocker no longer gates the repo.
- source_refs:
  - `docs/context/current-state.md#Blocked Work`
  - `docs/runbooks/dependency-security.md#Local Commands`
