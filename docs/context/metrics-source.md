# Metrics Source

## Metadata

- updated_at: `2026-04-02T00:00:00+09:00`
- owner: `docs/context/adapter.json`
- status: `confirmed`
- review_at: `2026-04-09T00:00:00+09:00`
- supersedes: `none`
- evidence_quality: `direct`

## Source Of Truth

- The canonical store shape for Quest Agent metrics and tracking data lives in `lib/quest-agent/server/store.ts`.
- The server-backed preview contract that determines whether persisted metrics are trustworthy for dogfood use lives in `docs/vercel-preview-runbook.md`.

## Current Watch Item

- Keep the `preview/dogfood` server-backed contract pinned and readable before treating any lead-metrics snapshot as trustworthy cross-thread state.

## Non-Canonicalized Data

- No numeric metric values are canonicalized in this note.
- If a future thread needs live counts or ratios, read them from the store-backed source of truth instead of copying them into durable context.
