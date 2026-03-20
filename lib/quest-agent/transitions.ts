import { rebuildTrackingCollections } from "@/lib/quest-agent/detect-return";
import {
  clampWipLimit,
  defaultPortfolioSettings,
  defaultUiPreferences,
  emptyPersistedState,
  makeId,
  nowIso,
} from "@/lib/quest-agent/derive";
import type {
  Blocker,
  BlockerInput,
  BottleneckInterview,
  BuildImproveCheckInput,
  BuildImproveDecision,
  FocusGoalInput,
  Goal,
  GoalInput,
  MapInput,
  Milestone,
  ParkGoalInput,
  PersistedState,
  PortfolioSettings,
  PortfolioSettingsInput,
  UiPreferences,
  UiPreferencesInput,
  Quest,
  QuestEvent,
  QuestStatus,
  ResumeGoalInput,
  ResumeQueueItem,
  ReturnInterviewInput,
  ReturnRun,
  ReturnRunInput,
  Review,
  ReviewInput,
  TodayPlan,
  WorkSession,
  WorkSessionFinishInput,
  WorkSessionStartInput,
} from "@/lib/quest-agent/types";

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

function withTracking(state: PersistedState): PersistedState {
  const tracking = rebuildTrackingCollections(state);
  return {
    ...state,
    metaWorkFlags: tracking.metaWorkFlags,
    leadMetricsDaily: tracking.leadMetricsDaily,
  };
}

function cloneState(state: PersistedState): PersistedState {
  return {
    ...emptyPersistedState(),
    ...state,
    goals: [...state.goals],
    milestones: [...state.milestones],
    quests: [...state.quests],
    blockers: [...state.blockers],
    reviews: [...state.reviews],
    decisions: [...state.decisions],
    artifacts: [...state.artifacts],
    events: [...state.events],
    userProfile: {
      ...emptyPersistedState().userProfile,
      ...state.userProfile,
    },
    uiPreferences: {
      ...defaultUiPreferences(),
      ...(state.uiPreferences ?? {}),
    },
    portfolioSettings: {
      ...defaultPortfolioSettings(),
      ...state.portfolioSettings,
      wipLimit: clampWipLimit(state.portfolioSettings?.wipLimit),
    },
    resumeQueueItems: [...(state.resumeQueueItems ?? [])],
    workSessions: [...(state.workSessions ?? [])],
    metaWorkFlags: [...(state.metaWorkFlags ?? [])],
    bottleneckInterviews: [...(state.bottleneckInterviews ?? [])],
    buildImproveDecisions: [...(state.buildImproveDecisions ?? [])],
    returnRuns: [...(state.returnRuns ?? [])],
    leadMetricsDaily: [...(state.leadMetricsDaily ?? [])],
  };
}

function saveGoalRecord(state: PersistedState, goal: Goal): void {
  state.goals = [goal, ...state.goals.filter((item) => item.id !== goal.id)];
}

function saveQuestRecord(state: PersistedState, quest: Quest): void {
  state.quests = [quest, ...state.quests.filter((item) => item.id !== quest.id)].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function savePortfolioSettings(state: PersistedState, portfolioSettings: PortfolioSettings): void {
  state.portfolioSettings = {
    ...portfolioSettings,
    wipLimit: clampWipLimit(portfolioSettings.wipLimit),
  };
}

function saveUiPreferences(state: PersistedState, uiPreferences: UiPreferences): void {
  state.uiPreferences = {
    ...defaultUiPreferences(),
    ...uiPreferences,
  };
}

function saveResumeQueueItem(state: PersistedState, item: ResumeQueueItem): void {
  state.resumeQueueItems = [item, ...state.resumeQueueItems.filter((existing) => existing.id !== item.id)];
}

function saveBuildImproveDecisionRecord(state: PersistedState, decision: BuildImproveDecision): void {
  state.buildImproveDecisions = [decision, ...state.buildImproveDecisions.filter((item) => item.id !== decision.id)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function saveWorkSessionRecord(state: PersistedState, session: WorkSession): void {
  state.workSessions = [session, ...state.workSessions.filter((item) => item.id !== session.id)]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function saveBottleneckInterviewRecord(state: PersistedState, interview: BottleneckInterview): void {
  state.bottleneckInterviews = [interview, ...state.bottleneckInterviews.filter((item) => item.id !== interview.id)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function saveReturnRunRecord(state: PersistedState, returnRun: ReturnRun): void {
  state.returnRuns = [returnRun, ...state.returnRuns.filter((item) => item.id !== returnRun.id)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function findGoal(state: PersistedState, goalId: string): Goal {
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal) {
    throw new Error("Goal not found.");
  }
  return goal;
}

function findBuildImproveDecision(state: PersistedState, decisionId: string): BuildImproveDecision {
  const decision = state.buildImproveDecisions.find((item) => item.id === decisionId);
  if (!decision) {
    throw new Error("Build vs Improve decision not found.");
  }
  return decision;
}

function findWorkSession(state: PersistedState, sessionId: string): WorkSession {
  const session = state.workSessions.find((item) => item.id === sessionId);
  if (!session) {
    throw new Error("Work session not found.");
  }
  return session;
}

function activeGoalCount(state: PersistedState, excludingGoalId?: string): number {
  return state.goals.filter((goal) => goal.status === "active" && goal.id !== excludingGoalId).length;
}

function assertWipCapacity(state: PersistedState, excludingGoalId?: string): void {
  if (activeGoalCount(state, excludingGoalId) >= state.portfolioSettings.wipLimit) {
    throw new Error("The active goal limit is full. Park or complete another goal before activating this one.");
  }
}

function nextFocusableActiveGoalId(state: PersistedState, excludingGoalId?: string): string | null {
  return [...state.goals]
    .filter((goal) => goal.status === "active" && goal.id !== excludingGoalId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id ?? null;
}

function writeFocusGoal(state: PersistedState, focusGoalId: string | null, timestamp: string): void {
  savePortfolioSettings(state, {
    ...state.portfolioSettings,
    focusGoalId,
    updatedAt: timestamp,
  });
}

function pushFocusGoalEvent(state: PersistedState, goalId: string): void {
  state.events.push(
    buildEvent(goalId, "goal", goalId, "focus_goal_selected", {
      focusGoalId: goalId,
    }),
  );
}

function pushSwitchEvent(state: PersistedState, fromGoalId: string | null, toGoalId: string, reason: string): void {
  if (!fromGoalId || fromGoalId === toGoalId) {
    return;
  }

  state.events.push(
    buildEvent(toGoalId, "goal", toGoalId, "goal_switch_recorded", {
      fromGoalId,
      toGoalId,
      reason,
    }),
  );
}

function maybeMarkQuestInProgress(state: PersistedState, questId: string | null | undefined): void {
  if (!questId) {
    return;
  }

  const existing = state.quests.find((quest) => quest.id === questId);
  if (!existing || existing.status === "completed" || existing.status === "in_progress") {
    return;
  }

  const updatedQuest: Quest = {
    ...existing,
    status: "in_progress",
    updatedAt: nowIso(),
  };
  saveQuestRecord(state, updatedQuest);
  state.events.push(buildEvent(updatedQuest.goalId, "quest", updatedQuest.id, "quest_started", { status: updatedQuest.status }));
}

function buildBuildImproveDecision(input: BuildImproveCheckInput): BuildImproveDecision {
  const mode = input.category === "main"
    ? "build"
    : input.mainConnection === "direct"
      ? "build"
      : input.mainConnection === "supporting"
        ? "improve"
        : "avoidant";

  const rationale = mode === "build"
    ? "This session connects directly to the current main route."
    : mode === "improve"
      ? "This session supports delivery, but it is one layer removed from the main route."
      : "This session does not yet show a direct connection to the main route, so it risks becoming avoidance.";

  return {
    id: makeId(),
    goalId: input.goalId,
    questId: input.questId ?? null,
    category: input.category,
    mainConnection: input.mainConnection,
    artifactCommitment: input.artifactCommitment,
    timeboxMinutes: input.timeboxMinutes,
    doneWhen: input.doneWhen,
    mode,
    rationale,
    createdAt: nowIso(),
  };
}

function buildWorkSessionFromDecision(input: WorkSessionStartInput, decision: BuildImproveDecision): WorkSession {
  return {
    id: makeId(),
    goalId: input.goalId,
    questId: input.questId ?? decision.questId ?? null,
    gateDecisionId: decision.id,
    category: input.category,
    plannedMinutes: decision.timeboxMinutes,
    startedAt: nowIso(),
    endedAt: null,
    artifactNote: "",
  };
}

function appendReturnLaunchSession(state: PersistedState, input: ReturnRunInput): void {
  const activeSession = state.workSessions.find((session) => !session.endedAt);
  if (activeSession) {
    return;
  }

  const syntheticDecision: BuildImproveDecision = {
    id: makeId(),
    goalId: input.goalId,
    questId: input.questId ?? null,
    category: "main",
    mainConnection: "direct",
    artifactCommitment: input.next15mAction,
    timeboxMinutes: 15,
    doneWhen: input.next15mAction,
    mode: "build",
    rationale: "Return flow launched a short main session.",
    createdAt: nowIso(),
  };
  saveBuildImproveDecisionRecord(state, syntheticDecision);
  const session = buildWorkSessionFromDecision({
    goalId: input.goalId,
    questId: input.questId ?? null,
    category: "main",
    gateDecisionId: syntheticDecision.id,
  }, syntheticDecision);
  saveWorkSessionRecord(state, session);
  maybeMarkQuestInProgress(state, session.questId);
  state.events.push(
    buildEvent(input.goalId, "system", session.id, "work_session_started", {
      category: session.category,
      plannedMinutes: session.plannedMinutes,
      gateDecisionId: syntheticDecision.id,
      mode: syntheticDecision.mode,
      launchedFromReturn: true,
    }),
  );
}

export function saveGoalInState(sourceState: PersistedState, input: GoalInput): { state: PersistedState; goal: Goal } {
  const state = cloneState(sourceState);
  const timestamp = nowIso();
  const existing = input.id ? state.goals.find((goal) => goal.id === input.id) : null;
  const willBeActive = input.status === "active";

  if (willBeActive && (!existing || existing.status !== "active")) {
    assertWipCapacity(state, existing?.id);
  }

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

  saveGoalRecord(state, goal);
  state.events.push(
    buildEvent(goal.id, "goal", goal.id, existing ? "goal_refined" : "goal_created", {
      title: goal.title,
      refined: input.refined ?? false,
      status: goal.status,
      ...(input.intakeSnapshot ? { intakeSnapshot: input.intakeSnapshot } : {}),
    }),
  );

  if (goal.status === "active") {
    const previousFocusId = state.portfolioSettings.focusGoalId;
    writeFocusGoal(state, goal.id, timestamp);
    if (previousFocusId !== goal.id) {
      pushFocusGoalEvent(state, goal.id);
    }
  } else if (state.portfolioSettings.focusGoalId === goal.id) {
    const fallbackFocusId = nextFocusableActiveGoalId(state, goal.id);
    writeFocusGoal(state, fallbackFocusId, timestamp);
    if (fallbackFocusId) {
      pushFocusGoalEvent(state, fallbackFocusId);
    }
  }

  return { state: withTracking(state), goal };
}

export function replaceMapInState(sourceState: PersistedState, input: MapInput): PersistedState {
  const state = cloneState(sourceState);
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
    const sourceMilestone = input.milestones[milestoneIndex];
    return sourceMilestone.quests.map((quest, questIndex) => ({
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

  return withTracking(state);
}

export function updateQuestStatusInState(sourceState: PersistedState, questId: string, status: QuestStatus): { state: PersistedState; quest: Quest } {
  const state = cloneState(sourceState);
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
  saveQuestRecord(state, quest);
  state.events.push(buildEvent(quest.goalId, "quest", quest.id, eventType, { status }));
  return { state: withTracking(state), quest };
}

export function createBlockerInState(sourceState: PersistedState, input: BlockerInput): { state: PersistedState; blocker: Blocker } {
  const state = cloneState(sourceState);
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
  return { state: withTracking(state), blocker };
}

export function createReviewInState(sourceState: PersistedState, input: ReviewInput): { state: PersistedState; review: Review } {
  const state = cloneState(sourceState);
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

  return { state: withTracking(state), review };
}

export function recordTodayPlanInState(sourceState: PersistedState, goalId: string, plan: TodayPlan): PersistedState {
  const state = cloneState(sourceState);
  state.events.push(
    buildEvent(goalId, "system", goalId, "today_plan_generated", {
      mode: plan.mode,
      theme: plan.theme,
      quests: plan.quests.map((quest) => quest.title),
    }),
  );
  return withTracking(state);
}

export function updatePortfolioSettingsInState(sourceState: PersistedState, input: PortfolioSettingsInput): { state: PersistedState; portfolioSettings: PortfolioSettings } {
  const state = cloneState(sourceState);
  const nextWipLimit = clampWipLimit(input.wipLimit);
  if (activeGoalCount(state) > nextWipLimit) {
    throw new Error("Park or complete an active goal before lowering the active limit.");
  }

  const portfolioSettings: PortfolioSettings = {
    ...state.portfolioSettings,
    wipLimit: nextWipLimit,
    updatedAt: nowIso(),
  };
  savePortfolioSettings(state, portfolioSettings);
  return { state: withTracking(state), portfolioSettings };
}

export function updateUiPreferencesInState(sourceState: PersistedState, input: UiPreferencesInput): { state: PersistedState; uiPreferences: UiPreferences } {
  const state = cloneState(sourceState);
  const uiPreferences: UiPreferences = {
    ...defaultUiPreferences(),
    ...state.uiPreferences,
    locale: input.locale,
  };
  saveUiPreferences(state, uiPreferences);
  return { state: withTracking(state), uiPreferences };
}

export function selectFocusGoalInState(sourceState: PersistedState, input: FocusGoalInput): { state: PersistedState; goal: Goal } {
  const state = cloneState(sourceState);
  const timestamp = nowIso();
  const goal = findGoal(state, input.goalId);
  const waitingItem = state.resumeQueueItems.find((item) => item.goalId === goal.id && item.status === "waiting");

  if (goal.status === "completed") {
    throw new Error("Completed goals cannot become the focus goal.");
  }
  if (goal.status === "abandoned" || waitingItem) {
    throw new Error("This goal is parked. Resume it from the queue so the restart note stays attached.");
  }

  let nextGoal = goal;
  if (goal.status !== "active") {
    assertWipCapacity(state, goal.id);
    nextGoal = {
      ...goal,
      status: "active",
      updatedAt: timestamp,
    };
    saveGoalRecord(state, nextGoal);
  }

  const previousFocusId = state.portfolioSettings.focusGoalId;
  writeFocusGoal(state, nextGoal.id, timestamp);
  if (previousFocusId !== nextGoal.id) {
    pushSwitchEvent(state, previousFocusId, nextGoal.id, input.reason);
    pushFocusGoalEvent(state, nextGoal.id);
  }

  return { state: withTracking(state), goal: nextGoal };
}

export function parkGoalInState(sourceState: PersistedState, input: ParkGoalInput): { state: PersistedState; goal: Goal; queueItem: ResumeQueueItem } {
  const state = cloneState(sourceState);
  const timestamp = nowIso();
  const goal = findGoal(state, input.goalId);

  if (goal.status === "completed") {
    throw new Error("Completed goals do not need to be parked.");
  }

  const nextStatus = input.stopMode === "cancel" ? "abandoned" : "paused";
  const updatedGoal: Goal = {
    ...goal,
    status: nextStatus,
    updatedAt: timestamp,
  };
  saveGoalRecord(state, updatedGoal);

  const queueItem: ResumeQueueItem = {
    id: makeId(),
    goalId: goal.id,
    stopMode: input.stopMode,
    parkedAt: timestamp,
    reason: input.reason,
    parkingNote: input.parkingNote,
    nextRestartStep: input.nextRestartStep,
    resumeTriggerType: input.resumeTriggerType,
    resumeTriggerText: input.resumeTriggerText,
    status: "waiting",
  };

  state.resumeQueueItems = state.resumeQueueItems.filter((item) => !(item.goalId === goal.id && item.status === "waiting"));
  saveResumeQueueItem(state, queueItem);

  const eventType = input.stopMode === "hold" ? "goal_parked" : input.stopMode === "shrink" ? "goal_shrunk" : "goal_cancelled";
  state.events.push(
    buildEvent(goal.id, "goal", goal.id, eventType, {
      stopMode: input.stopMode,
      reason: input.reason,
      parkingNote: input.parkingNote,
      nextRestartStep: input.nextRestartStep,
    }),
    buildEvent(goal.id, "system", queueItem.id, "resume_trigger_set", {
      resumeTriggerType: input.resumeTriggerType,
      resumeTriggerText: input.resumeTriggerText,
    }),
  );

  if (state.portfolioSettings.focusGoalId === goal.id) {
    const fallbackFocusId = nextFocusableActiveGoalId(state, goal.id);
    writeFocusGoal(state, fallbackFocusId, timestamp);
    if (fallbackFocusId) {
      pushFocusGoalEvent(state, fallbackFocusId);
    }
  }

  return { state: withTracking(state), goal: updatedGoal, queueItem };
}

export function resumeGoalInState(sourceState: PersistedState, input: ResumeGoalInput): { state: PersistedState; goal: Goal } {
  const state = cloneState(sourceState);
  const timestamp = nowIso();
  const goal = findGoal(state, input.goalId);
  const waitingItem = [...state.resumeQueueItems]
    .filter((item) => item.goalId === goal.id && item.status === "waiting")
    .sort((left, right) => right.parkedAt.localeCompare(left.parkedAt))[0];

  if (!waitingItem) {
    throw new Error("This goal is not waiting in the resume queue.");
  }

  if (goal.status !== "active") {
    assertWipCapacity(state, goal.id);
  }

  const resumedGoal: Goal = {
    ...goal,
    status: "active",
    updatedAt: timestamp,
  };
  saveGoalRecord(state, resumedGoal);
  state.resumeQueueItems = state.resumeQueueItems.map((item) => (item.id === waitingItem.id ? { ...item, status: "resumed" } : item));

  const previousFocusId = state.portfolioSettings.focusGoalId;
  writeFocusGoal(state, resumedGoal.id, timestamp);
  state.events.push(
    buildEvent(resumedGoal.id, "goal", resumedGoal.id, "goal_resumed", {
      queueItemId: waitingItem.id,
      reason: input.reason ?? "Resume from queue",
      nextRestartStep: waitingItem.nextRestartStep,
      resumeTriggerType: waitingItem.resumeTriggerType,
      resumeTriggerText: waitingItem.resumeTriggerText,
    }),
  );

  if (previousFocusId !== resumedGoal.id) {
    pushSwitchEvent(state, previousFocusId, resumedGoal.id, input.reason ?? "Resume from queue");
    pushFocusGoalEvent(state, resumedGoal.id);
  }

  return { state: withTracking(state), goal: resumedGoal };
}

export function recordBuildImproveDecisionInState(sourceState: PersistedState, input: BuildImproveCheckInput): { state: PersistedState; decision: BuildImproveDecision } {
  const state = cloneState(sourceState);
  findGoal(state, input.goalId);
  const decision = buildBuildImproveDecision(input);
  saveBuildImproveDecisionRecord(state, decision);
  state.events.push(
    buildEvent(input.goalId, "system", decision.id, "build_improve_checked", {
      category: input.category,
      mainConnection: input.mainConnection,
      mode: decision.mode,
      timeboxMinutes: input.timeboxMinutes,
    }),
  );
  return { state: withTracking(state), decision };
}

export function startWorkSessionInState(sourceState: PersistedState, input: WorkSessionStartInput): { state: PersistedState; session: WorkSession } {
  const state = cloneState(sourceState);
  findGoal(state, input.goalId);
  const activeSession = state.workSessions.find((session) => !session.endedAt);
  if (activeSession) {
    throw new Error("Finish the current work session before starting another one.");
  }

  const decision = findBuildImproveDecision(state, input.gateDecisionId);
  if (decision.goalId !== input.goalId || decision.category !== input.category) {
    throw new Error("The selected gate decision does not match this session.");
  }

  const session = buildWorkSessionFromDecision(input, decision);
  saveWorkSessionRecord(state, session);
  maybeMarkQuestInProgress(state, session.questId);
  state.events.push(
    buildEvent(session.goalId, "system", session.id, "work_session_started", {
      category: session.category,
      plannedMinutes: session.plannedMinutes,
      gateDecisionId: decision.id,
      mode: decision.mode,
    }),
  );

  return { state: withTracking(state), session };
}

export function finishWorkSessionInState(sourceState: PersistedState, input: WorkSessionFinishInput): { state: PersistedState; session: WorkSession } {
  const state = cloneState(sourceState);
  const existing = findWorkSession(state, input.sessionId);
  if (existing.endedAt) {
    throw new Error("This work session is already finished.");
  }

  const session: WorkSession = {
    ...existing,
    endedAt: nowIso(),
    artifactNote: input.artifactNote?.trim() ?? "",
  };
  saveWorkSessionRecord(state, session);
  state.events.push(
    buildEvent(session.goalId, "system", session.id, "work_session_finished", {
      category: session.category,
      plannedMinutes: session.plannedMinutes,
      artifactNote: session.artifactNote,
    }),
  );

  return { state: withTracking(state), session };
}

export function recordReturnInterviewInState(sourceState: PersistedState, input: ReturnInterviewInput): { state: PersistedState; interview: BottleneckInterview } {
  const state = cloneState(sourceState);
  findGoal(state, input.goalId);
  const interview: BottleneckInterview = {
    id: makeId(),
    goalId: input.goalId,
    mainQuest: input.mainQuest,
    primaryBottleneck: input.primaryBottleneck,
    avoidanceHypothesis: input.avoidanceHypothesis,
    smallestWin: input.smallestWin,
    createdAt: nowIso(),
  };

  saveBottleneckInterviewRecord(state, interview);
  state.events.push(
    buildEvent(input.goalId, "system", interview.id, "return_interview_saved", {
      primaryBottleneck: interview.primaryBottleneck,
    }),
  );

  return { state: withTracking(state), interview };
}

export function recordReturnRunInState(sourceState: PersistedState, input: ReturnRunInput): { state: PersistedState; returnRun: ReturnRun } {
  let state = cloneState(sourceState);
  findGoal(state, input.goalId);

  if (input.decision === "hold") {
    const parked = parkGoalInState(state, {
      goalId: input.goalId,
      stopMode: "hold",
      reason: input.parkingReason ?? input.decisionNote ?? "Pause and keep a clean restart.",
      parkingNote: input.parkingNote ?? input.mirrorMessage,
      nextRestartStep: input.nextRestartStep ?? input.next15mAction,
      resumeTriggerType: input.resumeTriggerType ?? "manual",
      resumeTriggerText: input.resumeTriggerText ?? "Return when the route is clear again.",
    });
    state = cloneState(parked.state);
  }

  if (input.decision === "retreat") {
    const reviewDate = input.reviewDate ?? nowIso().slice(0, 10);
    const parked = parkGoalInState(state, {
      goalId: input.goalId,
      stopMode: "cancel",
      reason: input.parkingReason ?? input.decisionNote ?? "Step back and review this later.",
      parkingNote: input.parkingNote ?? input.mirrorMessage,
      nextRestartStep: input.nextRestartStep ?? `Review whether this deserves to return on ${reviewDate}.`,
      resumeTriggerType: "date",
      resumeTriggerText: reviewDate,
    });
    state = cloneState(parked.state);
  }

  const returnRun: ReturnRun = {
    id: makeId(),
    goalId: input.goalId,
    questId: input.questId ?? null,
    interviewId: input.interviewId ?? null,
    mirrorMessage: input.mirrorMessage,
    diagnosisType: input.diagnosisType,
    woopPlan: input.woopPlan,
    ifThenPlan: input.ifThenPlan,
    next15mAction: input.next15mAction,
    decision: input.decision,
    decisionNote: input.decisionNote ?? "",
    reviewDate: input.reviewDate ?? null,
    createdAt: nowIso(),
  };

  saveReturnRunRecord(state, returnRun);
  state.events.push(
    buildEvent(input.goalId, "system", returnRun.id, "return_run_saved", {
      decision: input.decision,
      diagnosisType: input.diagnosisType,
      interviewId: input.interviewId ?? null,
    }),
  );

  if (input.decision === "detour") {
    state.events.push(
      buildEvent(input.goalId, "system", returnRun.id, "route_changed", {
        decision: input.decision,
        stopMode: "shrink",
        note: input.decisionNote ?? input.next15mAction,
      }),
    );
  }

  if (input.decision === "fight" || input.decision === "detour") {
    appendReturnLaunchSession(state, input);
  }

  return { state: withTracking(state), returnRun };
}
