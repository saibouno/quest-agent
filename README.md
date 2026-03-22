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

## Preview modes

- `preview/demo` is disposable and uses browser `localStorage` when Supabase is unavailable.
- `preview/dogfood` is persistent and must stay `server-backed` with the intended Supabase target.

## Source of truth

- Product and architecture decisions live in `docs/`.
- Role prompts live in `prompts/`.
- Deterministic state, validation, and persistence live in `lib/quest-agent/`.

## Helpful commands

```bash
npm.cmd run lint:noprofile
npm.cmd run typecheck:noprofile
npm.cmd run build
```

## Notes

- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- GitHub PRs should be created in Japanese by default.
