# Durable Context Promotion

## Purpose

- Make `docs/context/adapter.json` the repo-local owner of canonical durable context.
- Promote only the smallest durable delta that a future thread needs to recover the repo's current state.
- Keep `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` as the closeout gate that auto-runs durable-context promotion.
- Keep promotion rules here; skills and theme-loop docs should only point back to this runbook.

## Repo Adapter Mapping

- `state summary` -> `docs/context/current-state.md`
- `active plan pointer` -> `docs/context/current-state.meta.json`
- `decision store` -> `docs/context/decisions/*.md`
- `open questions / blockers` -> `docs/context/open-questions.md`
- `metric source` -> `docs/context/metrics-source.md`
- `workflow skills` -> `.agents/skills/theme-loop/SKILL.md`, `.agents/skills/context-promotion/SKILL.md`

## Promotion Rubric

Promote only information that is one of these:

- a confirmed decision that still shapes future work
- reusable current state another fresh thread would otherwise have to rediscover
- a blocker or open question that changes the next action
- a metric source pointer or watch item

Do not promote:

- raw logs
- one-off tool output
- scratch notes
- thread retellings
- historical material outside the current-relevance window unless it is still an active decision

## Source Priority And Stopping Rule

- Read sources in this order: canonical, then derived, then fallback.
- In this repo, derived evidence means the latest 3 themes or 90 days of `output/theme_ops/*`, whichever is smaller.
- Fallback evidence stays fallback-only unless the same information is confirmed from canonical or derived sources.
- Stop promoting once a fresh thread can reconstruct the current state, active blocker, fallback focus, and standing decisions from `docs/context/*` plus orientation docs alone.

## Metadata Convention

- Markdown durable artifacts use a visible `Metadata` section instead of frontmatter.
- JSON durable artifacts store metadata as top-level fields.
- Every durable artifact should encode `updated_at`, `owner`, `status`, `review_at`, and `supersedes`.
- Use `owner = docs/context/adapter.json` for all canonical durable-context artifacts in this repo.

## Evidence Quality

- `direct`: derived from current canonical code/docs without interpretation-heavy reconstruction
- `derived`: promoted from scratch artifacts such as theme state or closeout evidence
- `fallback`: supported only by fallback sources and not yet reconfirmed elsewhere
- `mixed`: assembled from more than one evidence tier

## `source_refs[]` Schema

```json
{
  "kind": "thread|markdown|json|spreadsheet|other",
  "path_or_uri": "string",
  "locator": "string",
  "captured_at": "ISO-8601 timestamp"
}
```

## Closeout Payload

Every theme closeout that changes durable context should record only this delta:

- `what_changed`
- `new_confirmed_decisions`
- `state_delta`
- `open_questions_delta`
- `metric_delta`
- `source_refs`

## Auto Promotion Contract

- `node scripts/theme-ops.mjs explain --slug <slug> ...` is the repo-local owner of structured durable input in theme state.
- `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>` auto-runs promotion through `scripts/promote-durable-context.mjs`.
- The helper reads only `docs/context/adapter.json`, adapter-owned canonical artifacts, and the saved theme state.
- Auto-promotion must not read adapter-declared fallback sources in v1.
- `explain` captures stale-write hashes for only the canonical artifacts the helper may touch.
- Auto-promotion returns:
  - `applied` when canonical durable-context artifacts changed
  - `noop` when no durable delta was recorded or the rendered patch is empty after comparison
  - `blocked` when validation, ownership, stale-hash, duplicate-id, or write-safety checks fail
- Canonical writes must be crash-safe:
  - render the full patch set in memory first
  - validate every rendered artifact before writing
  - stage temp files first, then replace canonical targets
  - restore already-touched canonical files if any replace fails

## Closeout Hook

- After `node scripts/theme-ops.mjs aftercare --slug <slug> ...`
- After `node scripts/theme-ops.mjs explain --slug <slug> ...`
- During `node scripts/theme-harness.mjs scaffold-closeout --slug <slug>`

At that point:

- inspect whether the theme created a durable delta
- auto-promote the smallest necessary canonical artifacts under `docs/context/*`
- stop with `noop` if there is no durable delta to promote
- stop with `blocked` and keep the workflow at `verified` if promotion validation or writes fail
