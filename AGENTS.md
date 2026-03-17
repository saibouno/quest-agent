# Quest Agent Repo Guide

Start here when you need to understand or change the product.

## Read Order
1. `README.md`
2. `docs/v0_2-agent-architecture.md`
3. `docs/v0_2-role-io-contracts.md`
4. `docs/vercel-preview-runbook.md`

## Source Of Truth
- Product and architecture decisions live in `docs/`.
- Role prompts live in `prompts/`.
- Deterministic state, validation, and persistence rules live in `lib/quest-agent/`.

## Working Rules
- External behavior stays as one Quest Agent.
- The 5 internal roles are scaffold only in v0.2.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- Vercel Preview without Supabase uses browser `localStorage`, not server file writes.