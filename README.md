# Quest Agent

Quest Agent is a single-product execution companion that helps one user turn a serious goal into an executable flow, restart after stalls, and keep the next step visible.

## Current flow

- `"/"` routes to the right place for the current state.
- New goal onboarding starts at `/onboarding/intake`.
- Route planning happens at `/onboarding/map`.
- Daily execution happens at `/today`.
- Goal management and resumption live in `/portfolio`.
- Weekly reflection lives in `/review`.

## Internal model

The repo is still one Quest Agent from the outside. Internally, v0.2 uses a scaffold of five roles:

- Scout
- Realist
- Skeptic
- Router
- Archivist

These roles structure prompts, contracts, and orchestration, but they are not exposed as independent agents in the product UI.
For the architecture boundary and role I/O details, start with [docs/v0_2-agent-architecture.md](docs/v0_2-agent-architecture.md) and [docs/v0_2-role-io-contracts.md](docs/v0_2-role-io-contracts.md).

## Preview modes

- `preview/demo` is the lightweight preview and may fall back to browser-local storage.
- `preview/dogfood` is the stable preview and must stay persistent and `server-backed`.

For promotion flow, backup and rollback helpers, and the environment contract, see [docs/continuous-improvement-operations.md](docs/continuous-improvement-operations.md).

## Source of truth

- Product and architecture decisions live in `docs/`.
- Role prompts live in `prompts/`.
- Deterministic state, validation, and persistence live in `lib/quest-agent/`.
- Command spellings live in `package.json`.

## Helpful commands

| Use | Command |
| --- | --- |
| local dev | `npm.cmd run dev` |
| memory debug | `npm.cmd run dev:inspect` |
| local checks | `npm.cmd run lint:noprofile` |
| local checks | `npm.cmd run typecheck:noprofile` |
| local checks | `npm.cmd run build` |
| local checks | `npm.cmd run guardrails:noprofile` |
| copy audit | `npm.cmd run copy:audit` |
| dogfood ops | `npm.cmd run dogfood:backup:noprofile` |
| dogfood ops | `npm.cmd run dogfood:restore:check:noprofile` |

## Notes

- The local dev server is intentionally heap-capped to reduce runaway RAM usage during Next.js development.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- GitHub PRs should be created in Japanese by default.
