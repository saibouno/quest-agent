# Current State

## Metadata

- updated_at: `2026-04-02T00:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-09T00:00:00+09:00`
- supersedes: `none`
- evidence_quality: `mixed`
- source_refs:
  - `AGENTS.md#Read Order`
  - `README.md#Current flow`
  - `output/theme_ops/quest-agent-local-verification-doc-alignment-v1.json`
  - `output/theme_ops/quest-agent-nested-worktree-build-followup-v1.json`
  - `output/theme_ops/quest-agent-security-baseline.json`

## Product Shape

- Quest Agent is still one product from the outside, with onboarding at `/onboarding/intake` and `/onboarding/map`, daily execution at `/today`, resumption and goal management at `/portfolio`, and weekly reflection at `/review`.
- The v0.2 five-role scaffold remains an internal prompt-and-orchestration boundary, not a user-facing multi-agent surface.
- Product and architecture truth still lives in `docs/`, while deterministic runtime/state rules still live in `lib/quest-agent/`.

## Current Focus

- The active repo focus is durable-context, docs, and harness hygiene around a blocked security hardening lane.
- This theme establishes a canonical `docs/context/*` surface so future threads can recover the repo's operating state without digging through old thread history.
- Closeout guidance now needs to update canonical durable context before scaffolded closeout, but the promotion step remains docs-and-skill driven in v1.

## Blocked Work

- Active blocked plan: `quest-agent-security-baseline`
- Blocker summary: as of 2026-04-01, `quest-agent-security-baseline` remained blocked by the Next.js `/_not-found` prerender invariant in its nested worktree build.
- Resume condition: the nested worktree build blocker is resolved or the verification lane is redefined onto a non-nested checkout path.

## Fallback Focus

- Prefer durable-context, docs, and non-blocked repo hygiene themes while the active security lane stays blocked.
- Keep app runtime, Supabase schema/data, and planning-host queue changes out of the fallback lane unless a separate theme explicitly reopens them.

## Recent Confirmed Decisions

- Windows-safe `:noprofile` verify/build spellings are the canonical command surface for this repo and should stay aligned across docs, harness state, and closeout.
- Nested worktree tooling should resolve the canonical repo root through git common-dir first and prefer checkout-local `node_modules` before falling back to the canonical install.
- Generated harness artifacts under `output/theme_ops/` remain scratch-only evidence, not canonical current-state owners.

## Next Safe Themes

- Durable-context and runbook follow-ups that stay within `docs/context/*`, harness docs, and related contract tests.
- Non-blocked repo hygiene themes that improve verification clarity, documentation fidelity, or scratch-artifact diagnostics without changing app runtime behavior.
- Future investigation of whether durable-context promotion needs automation can happen later, but v1 should keep the promotion step manual and lightweight.
