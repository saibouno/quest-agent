# Quest Agent v0.2 Role I/O Contracts

## Shared state
The shared state stays focused on one user's active execution flow.

```json
{
  "goal": {},
  "milestones": [],
  "quests": [],
  "blockers": [],
  "reviews": [],
  "decisions": [],
  "artifacts": [],
  "events": [],
  "user_profile": {
    "prefersSmallSteps": true,
    "getsStuckOnAmbiguity": true,
    "tendsToOverresearch": true,
    "bestWorkBlockMinutes": 25,
    "worksBestTime": "morning",
    "needsOptionComparison": true,
    "restartsBetterWithTinyActions": true
  }
}
```

## Scout
### Input
- user natural language
- existing structured state
- prior conversation context
- optional external context later

### Output
- `goalSummary`
- `deadline`
- `constraints`
- `successCriteria`
- `currentState`
- `openQuestions`
- `collectedContext`

## Realist
### Input
- Scout summary
- goals, milestones, quests
- time and energy constraints
- current blockers

### Output
- `milestones`
- `feasibilityNotes`
- `todayCandidateQuests`
- `dependencyNotes`

## Skeptic
### Input
- Realist plan
- blocker logs
- execution history
- user tendencies

### Output
- `risks`
- `likelyWastedStalls`
- `assumptionsToTest`
- `simplificationIdeas`

## Router
### Input
- Realist plan
- Skeptic concerns when applicable
- current blockers
- user profile

### Output
- `mainRoute`
- `alternateRoutes`
- `todayPlan`
- `firstNextAction`

## Archivist
### Input
- user-confirmed changes
- role outputs
- execution logs
- accepted reroutes or decisions

### Output
- `updatedStateSummary`
- `events`
- `decisionRecords`
- `summarySnapshot`

## Review
The Review surface can show a lightweight recent trace for the current goal by reading the latest reserved role events already saved for that goal. It stays intentionally thin: enough to glance back at recent internal routing context, not a full role-by-role operator console.

## Route taxonomy
The Router uses these route types in v0.2:
- `direct_route`
- `lightweight_detour`
- `temporary_assumption_route`
- `dependency_wait_route`
- `information_gathering_route`
- `energy_matched_route`

## Event additions for the scaffold
In addition to v0.1 events, v0.2 defines these reserved role event names.

Currently emitted after deterministic save succeeds:
- `scout_context_collected`
- `realist_plan_generated`
- `skeptic_risk_flagged`
- `router_route_selected`
- `archivist_snapshot_saved`

Still reserved-only and not emitted yet:
- `user_profile_updated`

The emit boundary is deterministic persistence, not the moment an AI response is returned. Preview, draft, or suggestion output by itself does not emit these events; they appear only after the corresponding save path succeeds and canonical state is updated.

## Important boundary
The role contracts exist to structure future internal reasoning.
They do not override deterministic validation, persistence, or state mutation rules.
