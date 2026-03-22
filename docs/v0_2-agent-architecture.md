# Quest Agent v0.2 Agent Architecture

## One-sentence definition
Quest Agent is an execution companion that turns a serious goal into an executable flow, helps the user restart after stalls, and raises the probability of completion.

## External behavior
From the outside, the product behaves like one Quest Agent.
The user should not need to understand or manage multiple agents.

## Internal 5-role model
v0.2 introduces an internal scaffold for five roles:
- Scout
- Realist
- Skeptic
- Router
- Archivist

These roles are not fully autonomous agents yet.
They are internal responsibilities with prompts, types, schemas, and orchestration order.

## Role summary
- Scout: gathers goal context, constraints, current state, and open questions.
- Realist: turns the goal into a feasible route, milestones, and today-sized work.
- Skeptic: identifies waste, false blockers, risky assumptions, and simplifications.
- Router: selects the main route, alternate routes, and today's next action.
- Archivist: decides what belongs in canonical state, events, and decisions.

## Workflow loops
### Normal loop
Scout -> Realist -> Router -> Archivist

### Stuck loop
Scout -> Skeptic -> Realist -> Router -> Archivist

### Decision-heavy loop
Scout -> Realist -> Skeptic -> Router -> Archivist

## Current implementation boundary
v0.2 deliberately stops at scaffold level and keeps the five roles internal to the product.
Included now:
- prompt files in `prompts/`
- public role output types in `lib/quest-agent/types.ts`
- role JSON schemas in `lib/quest-agent/roles/scaffold.ts`
- orchestration skeleton in `lib/quest-agent/server/orchestration.ts`
- existing AI endpoints internally wired to the scaffold

Not included yet:
- role-specific long-running logic
- role-by-role UI exposure
- multi-agent memory or negotiation
- autonomous state mutation by roles

## Deterministic boundary
Prompts are advisory.
The source of truth remains deterministic code:
- persistence rules in `lib/quest-agent/server/store.ts`
- browser preview persistence in `lib/quest-agent/browser-store.ts`
- request validation in `lib/quest-agent/validation.ts`
- shared state derivation in `lib/quest-agent/derive.ts`

This keeps state transitions, event logging, and secret boundaries predictable.

## Storage architecture
### Server side
Server code only decides between:
- `supabase`
- `local-file`

That decision lives in `lib/quest-agent/server/runtime.ts`.
`SUPABASE_SERVICE_ROLE_KEY` is only read on the server.
`preview/dogfood` adds a guardrail on top: it must resolve to `supabase`, never `local-file`.

### Client side
Client code only decides between:
- `server-backed`
- `browser-local`

That decision lives in `lib/quest-agent/client/runtime.ts`.
`browser-local` is activated only after hydration.
`preview/dogfood` adds a guardrail on top: it must resolve to `server-backed`, never `browser-local`.

## Preview rule
When running on Vercel without Supabase, the app switches to browser `localStorage` for persistence.
This keeps preview deployments usable without trying to write to Vercel's read-only filesystem.

The deployment target now matters:
- `preview/demo` may use `browser-local`
- `preview/dogfood` must fail fast if Supabase is missing or repointed unexpectedly
