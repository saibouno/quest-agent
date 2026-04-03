# Open Questions And Blockers

## Metadata

- updated_at: `2026-04-04T00:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-11T00:00:00+09:00`
- supersedes: `none`
- evidence_quality: `direct`

## Open Questions

- none promoted right now; the remaining unresolved item is the external follow-up below.

## Blockers

### `github-repo-security-settings-access`

- id: `github-repo-security-settings-access`
- observed_at: `2026-04-04T00:00:00+09:00`
- impact: the repo-local dependency security baseline is implemented and verified, but the full done condition still depends on an admin-side pass over GitHub repository security settings.
- next unlock: a repository admin enables or confirms `Dependency graph`, `Dependabot alerts`, `Dependabot security updates`, and `Dependabot malware alerts`, then records completion in the merge handoff or PR.
- last_verified_by: `dependency-security baseline verification and GitHub settings follow-up @ 2026-04-04T00:00:00+09:00`
- evidence_ref: `docs/runbooks/dependency-security.md#Repo Settings Checklist`
