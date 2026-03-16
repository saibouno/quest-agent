# Quest Agent v0.1 Data Model

## モデル方針
- state table を正本とする
- append-only の events で履歴を残す
- v0.1 は単一ユーザー前提だが、複数 goal を保持できる形にしておく
- Supabase を本番前提にしつつ、ローカルでは file fallback を使う

## Entities

### goals
- `id: string`
- `title: string`
- `description: string`
- `why: string`
- `deadline: string | null`
- `successCriteria: string[]`
- `currentState: string`
- `constraints: string[]`
- `concerns: string`
- `todayCapacity: string`
- `status: draft | active | paused | completed | abandoned`
- `createdAt: string`
- `updatedAt: string`

### milestones
- `id: string`
- `goalId: string`
- `title: string`
- `description: string`
- `sequence: number`
- `targetDate: string | null`
- `status: planned | active | completed`
- `createdAt: string`

### quests
- `id: string`
- `goalId: string`
- `milestoneId: string | null`
- `title: string`
- `description: string`
- `priority: high | medium | low`
- `status: planned | ready | in_progress | blocked | completed`
- `dueDate: string | null`
- `estimatedMinutes: number | null`
- `questType: main | side`
- `createdAt: string`
- `updatedAt: string`

### blockers
- `id: string`
- `goalId: string`
- `relatedQuestId: string | null`
- `title: string`
- `description: string`
- `blockerType: clarity | time | decision | dependency | energy | unknown`
- `severity: high | medium | low`
- `status: open | resolved`
- `suggestedNextStep: string`
- `detectedAt: string`

### reviews
- `id: string`
- `goalId: string`
- `periodStart: string`
- `periodEnd: string`
- `summary: string`
- `learnings: string`
- `rerouteNote: string`
- `nextFocus: string`
- `createdAt: string`

### decisions
- `id: string`
- `goalId: string`
- `title: string`
- `description: string`
- `rationale: string`
- `decidedAt: string`

### artifacts
- `id: string`
- `goalId: string`
- `title: string`
- `artifactType: note | link | file | output`
- `urlOrRef: string`
- `note: string`
- `createdAt: string`

### events
- `id: string`
- `goalId: string`
- `entityType: goal | milestone | quest | blocker | review | decision | artifact | system`
- `entityId: string`
- `type: string`
- `payload: Record<string, unknown>`
- `createdAt: string`

## 関係
- goal 1 : N milestones
- milestone 1 : N quests
- goal 1 : N blockers
- goal 1 : N reviews
- goal 1 : N decisions
- goal 1 : N artifacts
- goal 1 : N events
- blocker N : 1 quest は任意

## 主要イベント
- `goal_created`
- `goal_refined`
- `milestone_defined`
- `quest_created`
- `quest_started`
- `quest_completed`
- `blocker_detected`
- `blocker_resolved`
- `today_plan_generated`
- `route_changed`
- `weekly_review_done`

## App-side derived state
- `currentGoal`
- `todaySuggestions`
- `openBlockers`
- `momentum`
- `nextQuest`
- `recentProgress`

## Fallback storage
- ファイル: `data/quest-agent-fallback.json`
- 保存形式: 各 entity を配列で保持する単一 JSON
- 開発専用であり、複数端末共有や同時更新は考慮しない

## Supabase schema notes
- `success_criteria`, `constraints` は `text[]`
- `events.payload` は `jsonb`
- 主要検索は `goal_id`, `status`, `created_at`
- v0.1 は server-side service role 経由で読み書きし、client に鍵を渡さない
