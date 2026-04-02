# Decision: Windows-Safe `:noprofile` Spellings

## Metadata

- updated_at: `2026-04-02T00:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-09T00:00:00+09:00`
- supersedes: `none`
- evidence_quality: `mixed`

## Decision

- The canonical local verification/build command surface for this repo is the Windows-safe `:noprofile` spellings: `harness:test:noprofile`, `lint:noprofile`, `typecheck:noprofile`, `build:noprofile`, and `guardrails:noprofile`.
- Repo docs, harness state, and future closeout summaries should keep those spellings aligned instead of falling back to profile-sensitive variants.

## Why It Stands

- `AGENTS.md`, `README.md`, `package.json`, and the 2026-03-30 `quest-agent-local-verification-doc-alignment-v1` evidence all converge on the same command surface.
- This avoids PowerShell profile-related `PSSecurityException` and intermittent `spawn EPERM` friction that the repo already documents as a Windows workspace concern.

## Operational Consequence

- New docs and harness updates should treat `:noprofile` as the default local verification wording.
- If a later theme changes the command surface, it must update both the docs and the harness-facing evidence together rather than letting historical spellings drift.

## Source Refs

- `package.json#scripts`
- `AGENTS.md#Repo Rules`
- `README.md#Helpful commands`
- `output/theme_ops/quest-agent-local-verification-doc-alignment-v1.json`
