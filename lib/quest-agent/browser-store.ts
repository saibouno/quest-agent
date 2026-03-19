import {
  emptyPersistedState,
  enrichState,
  makeId,
  nowIso,
} from "@/lib/quest-agent/derive";
import type {
  AppState,
  Blocker,
  BlockerInput,
  Goal,
  GoalInput,
  MapInput,
  Milestone,
  PersistedState,
  Quest,
  QuestEvent,
  QuestStatus,
  Review,
  ReviewInput,
  TodayPlan,
} from "@/lib/quest-agent/types";

const browserStateKey = "quest-agent-browser-preview-state";

function buildEvent(goalId: string, entityType: QuestEvent["entityType"], entityId: string, type: string, payload: Record<string, unknown>): QuestEvent {
  return {
    id: makeId(),
    goalId,
    entityType,
    entityId,
    type,
    payload,
    createdAt: nowIso(),
  };
}

export function readBrowserState(): PersistedState {
  if (typeof window === "undefined") {
    return emptyPersistedState();
  }

  const raw = window.localStorage.getItem(browserStateKey);
  if (!raw) {
    return emptyPersistedState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      ...emptyPersistedState(),
      ...parsed,
      userProfile: {
        ...emptyPersistedState().userProfile,
        ...(parsed.userProfile ?? {}),
      },
    };
  } catch {
    return emptyPersistedState();
  }
}

export function writeBrowserState(state: PersistedState): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(browserStateKey, JSON.stringify(state));
}

export function readBrowserAppState(): AppState {
  return enrichState(readBrowserState());
}

export function saveGoalInBrowser(input: GoalInput): Goal {
  const state = readBrowserState();
  const timestamp = nowIso();
  const existing = input.id ? state.goals.find((goal) => goal.id === input.id) : null;
  const goal: Goal = existing
    ? {
        ...existing,
        title: input.title,
        description: input.description,
        why: input.why,
        deadline: input.deadline ?? null,
        successCriteria: input.successCriteria,
        currentState: input.currentState,
        constraints: input.constraints,
        concerns: input.concerns,
        todayCapacity: input.todayCapacity,
        status: input.status,
        updatedAt: timestamp,
      }
    : {
        id: makeId(),
        title: input.title,
        description: input.description,
        why: input.why,
        deadline: input.deadline ?? null,
        successCriteria: input.successCriteria,
        currentState: input.currentState,
        constraints: input.constraints,
        concerns: input.concerns,
        todayCapacity: input.todayCapacity,
        status: input.status,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

  state.goals = [goal, ...state.goals.filter((item) => item.id !== goal.id)].map((item) =>
    goal.status === "active" && item.id !== goal.id && item.status === "active"
      ? { ...item, status: "paused", updatedAt: timestamp }
      : item,
  );
  state.events.push(
    buildEvent(goal.id, "goal", goal.id, existing ? "goal_refined" : "goal_created", {
      title: goal.title,
      refined: input.refined ?? false,
    }),
  );

  writeBrowserState(state);
  return goal;
}

export function replaceMapInBrowser(input: MapInput): void {
  const state = readBrowserState();
  const timestamp = nowIso();
  const milestoneRecords: Milestone[] = input.milestones.map((milestone, index) => ({
    id: makeId(),
    goalId: input.goalId,
    title: milestone.title,
    description: milestone.description,
    sequence: index + 1,
    targetDate: milestone.targetDate ?? null,
    status: index === 0 ? "active" : "planned",
    createdAt: timestamp,
  }));

  const questRecords: Quest[] = milestoneRecords.flatMap((milestone, milestoneIndex) => {
    const source = input.milestones[milestoneIndex];
    return source.quests.map((quest, questIndex) => ({
      id: makeId(),
      goalId: input.goalId,
      milestoneId: milestone.id,
      title: quest.title,
      description: quest.description,
      priority: quest.priority,
      status: milestoneIndex === 0 && questIndex === 0 ? "ready" : "planned",
      dueDate: quest.dueDate ?? null,
      estimatedMinutes: quest.estimatedMinutes ?? null,
      questType: quest.questType,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
  });

  state.milestones = [...state.milestones.filter((milestone) => milestone.goalId !== input.goalId), ...milestoneRecords];
  state.quests = [...state.quests.filter((quest) => quest.goalId !== input.goalId), ...questRecords];
  state.events.push(
    ...milestoneRecords.map((milestone) => buildEvent(input.goalId, "milestone", milestone.id, "milestone_defined", { title: milestone.title })),
    ...questRecords.map((quest) => buildEvent(input.goalId, "quest", quest.id, "quest_created", { title: quest.title })),
    buildEvent(input.goalId, "system", input.goalId, "route_changed", {
      routeSummary: input.routeSummary,
      mode: input.mode,
    }),
  );

  writeBrowserState(state);
}

export function updateQuestStatusInBrowser(questId: string, status: QuestStatus): Quest {
  const state = readBrowserState();
  const existing = state.quests.find((quest) => quest.id === questId);
  if (!existing) {
    throw new Error("Quest not found.");
  }

  const quest: Quest = {
    ...existing,
    status,
    updatedAt: nowIso(),
  };

  const eventType = status === "in_progress" ? "quest_started" : status === "completed" ? "quest_completed" : "quest_updated";
  state.quests = state.quests.map((item) => (item.id === questId ? quest : item));
  state.events.push(buildEvent(quest.goalId, "quest", quest.id, eventType, { status }));
  writeBrowserState(state);
  return quest;
}

export function createBlockerInBrowser(input: BlockerInput): Blocker {
  const state = readBrowserState();
  const blocker: Blocker = {
    id: makeId(),
    goalId: input.goalId,
    relatedQuestId: input.relatedQuestId ?? null,
    title: input.title,
    description: input.description,
    blockerType: input.blockerType,
    severity: input.severity,
    status: input.status,
    suggestedNextStep: input.suggestedNextStep,
    detectedAt: nowIso(),
  };

  state.blockers = [blocker, ...state.blockers];
  state.events.push(buildEvent(blocker.goalId, "blocker", blocker.id, "blocker_detected", { title: blocker.title }));
  writeBrowserState(state);
  return blocker;
}

export function createReviewInBrowser(input: ReviewInput): Review {
  const state = readBrowserState();
  const review: Review = {
    id: makeId(),
    goalId: input.goalId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    summary: input.summary,
    learnings: input.learnings,
    rerouteNote: input.rerouteNote,
    nextFocus: input.nextFocus,
    createdAt: nowIso(),
  };

  state.reviews = [review, ...state.reviews];
  state.events.push(buildEvent(review.goalId, "review", review.id, "weekly_review_done", { summary: review.summary }));
  if (review.rerouteNote) {
    state.events.push(buildEvent(review.goalId, "system", review.goalId, "route_changed", { rerouteNote: review.rerouteNote }));
  }

  writeBrowserState(state);
  return review;
}

export function recordTodayPlanInBrowser(goalId: string, plan: TodayPlan): void {
  const state = readBrowserState();
  state.events.push(
    buildEvent(goalId, "system", goalId, "today_plan_generated", {
      mode: plan.mode,
      theme: plan.theme,
      quests: plan.quests.map((quest) => quest.title),
    }),
  );
  writeBrowserState(state);
}