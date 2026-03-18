import { buildMirrorCard, dayKeyFromIso, rebuildTrackingCollections } from "@/lib/quest-agent/detect-return";
import type {
  AppState,
  Blocker,
  BlockerReroute,
  BuildImproveDecision,
  Goal,
  IntakeRefinement,
  MapDraft,
  PersistedState,
  PortfolioSettings,
  Quest,
  QuestEvent,
  ResumeQueueEntry,
  ResumeQueueItem,
  Review,
  SwitchSummary,
  TodayPlan,
  TodayQuestSuggestion,
  UiPreferences,
  UserProfile,
  WorkSession,
} from "@/lib/quest-agent/types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(): string {
  return crypto.randomUUID();
}

export function clampWipLimit(value: number | undefined | null): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1;
  }
  return Math.min(3, Math.max(1, Math.round(value)));
}

export function defaultUserProfile(): UserProfile {
  return {
    prefersSmallSteps: true,
    getsStuckOnAmbiguity: true,
    tendsToOverresearch: true,
    bestWorkBlockMinutes: 25,
    worksBestTime: "morning",
    needsOptionComparison: true,
    restartsBetterWithTinyActions: true,
  };
}

export function defaultPortfolioSettings(): PortfolioSettings {
  return {
    wipLimit: 1,
    focusGoalId: null,
    updatedAt: nowIso(),
  };
}

export function defaultUiPreferences(): UiPreferences {
  return {
    locale: "ja",
  };
}

export function emptyPersistedState(): PersistedState {
  return {
    goals: [],
    milestones: [],
    quests: [],
    blockers: [],
    reviews: [],
    decisions: [],
    artifacts: [],
    events: [],
    userProfile: defaultUserProfile(),
    uiPreferences: defaultUiPreferences(),
    portfolioSettings: defaultPortfolioSettings(),
    resumeQueueItems: [],
    workSessions: [],
    metaWorkFlags: [],
    bottleneckInterviews: [],
    buildImproveDecisions: [],
    returnRuns: [],
    leadMetricsDaily: [],
  };
}

export function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function joinLines(values: string[]): string {
  return values.join("\n");
}

function sortGoals(goals: Goal[]): Goal[] {
  return [...goals].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortQueueItems(items: ResumeQueueItem[]): ResumeQueueItem[] {
  return [...items].sort((left, right) => right.parkedAt.localeCompare(left.parkedAt));
}

function sortSessions(sessions: WorkSession[]): WorkSession[] {
  return [...sessions].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function isRunnableGoal(goal: Goal): boolean {
  return goal.status !== "completed" && goal.status !== "abandoned";
}

function findFocusGoal(goals: Goal[], portfolioSettings: PortfolioSettings): Goal | null {
  const explicit = portfolioSettings.focusGoalId
    ? goals.find((goal) => goal.id === portfolioSettings.focusGoalId && goal.status !== "completed" && goal.status !== "abandoned")
    : null;

  if (explicit) {
    return explicit;
  }

  return sortGoals(goals.filter((goal) => goal.status === "active"))[0] ?? null;
}

function prioritizeFocusGoal(goals: Goal[], focusGoal: Goal | null): Goal[] {
  const sorted = sortGoals(goals);
  if (!focusGoal) {
    return sorted;
  }

  return sorted.sort((left, right) => {
    if (left.id === focusGoal.id) {
      return -1;
    }
    if (right.id === focusGoal.id) {
      return 1;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function daysSince(iso: string): number {
  const delta = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(delta / (24 * 60 * 60 * 1000)));
}

function isOverdue(item: ResumeQueueItem): boolean {
  if (item.resumeTriggerType !== "date") {
    return false;
  }

  const triggerDate = Date.parse(item.resumeTriggerText);
  if (Number.isNaN(triggerDate)) {
    return false;
  }

  return triggerDate < Date.now();
}

function average(values: number[]): number | null {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function weekKey(iso: string): string {
  const date = new Date(iso);
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const normalized = new Date(utc);
  const day = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((normalized.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${normalized.getUTCFullYear()}-${String(weekNumber).padStart(2, "0")}`;
}

function buildResumeQueueEntries(state: PersistedState): ResumeQueueEntry[] {
  const goalMap = new Map(state.goals.map((goal) => [goal.id, goal]));
  return sortQueueItems(state.resumeQueueItems)
    .filter((item) => item.status === "waiting")
    .map((item) => ({
      ...item,
      goal: goalMap.get(item.goalId) ?? null,
      isOverdue: isOverdue(item),
      parkedDays: daysSince(item.parkedAt),
    }));
}

function buildSwitchSummary(state: PersistedState): SwitchSummary {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const fourWeeksAgo = Date.now() - 28 * 24 * 60 * 60 * 1000;
  const resumeEvents = state.events.filter((event) => event.type === "goal_resumed");
  const resumeDelays = state.resumeQueueItems
    .filter((item) => item.status === "resumed")
    .map((item) => {
      const resumeEvent = resumeEvents.find((event) => event.goalId === item.goalId && event.createdAt >= item.parkedAt);
      if (!resumeEvent) {
        return null;
      }
      return (new Date(resumeEvent.createdAt).getTime() - new Date(item.parkedAt).getTime()) / (60 * 60 * 1000);
    })
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));

  const reviewWeekKeys = new Set(
    state.reviews.filter((review) => new Date(review.createdAt).getTime() >= fourWeeksAgo).map((review) => weekKey(review.createdAt)),
  );

  return {
    switchesThisWeek: state.events.filter((event) => event.type === "goal_switch_recorded" && new Date(event.createdAt).getTime() >= oneWeekAgo).length,
    averageResumeHours: average(resumeDelays),
    medianResumeHours: median(resumeDelays),
    parkingNoteRate: state.resumeQueueItems.length
      ? Math.round((state.resumeQueueItems.filter((item) => item.parkingNote.trim().length > 0).length / state.resumeQueueItems.length) * 100)
      : 0,
    reviewCompletionRate: Math.round((reviewWeekKeys.size / 4) * 100),
    reviewDoneThisWeek: state.reviews.some((review) => new Date(review.createdAt).getTime() >= oneWeekAgo),
  };
}

export function pickCurrentGoal(goals: Goal[], portfolioSettings?: PortfolioSettings): Goal | null {
  return findFocusGoal(goals, portfolioSettings ?? defaultPortfolioSettings());
}

export function buildTodaySuggestions(quests: Quest[], blockers: Blocker[]): TodayQuestSuggestion[] {
  const blockedQuestIds = new Set(
    blockers.filter((blocker) => blocker.status === "open" && blocker.relatedQuestId).map((blocker) => blocker.relatedQuestId),
  );
  const priorityScore = new Map([
    ["high", 0],
    ["medium", 1],
    ["low", 2],
  ]);
  const statusScore = new Map([
    ["in_progress", 0],
    ["ready", 1],
    ["planned", 2],
    ["blocked", 3],
    ["completed", 4],
  ]);

  return quests
    .filter((quest) => quest.status !== "completed")
    .sort((left, right) => {
      const statusDelta = (statusScore.get(left.status) ?? 4) - (statusScore.get(right.status) ?? 4);
      if (statusDelta !== 0) {
        return statusDelta;
      }
      const priorityDelta = (priorityScore.get(left.priority) ?? 2) - (priorityScore.get(right.priority) ?? 2);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return (left.estimatedMinutes ?? 45) - (right.estimatedMinutes ?? 45);
    })
    .slice(0, 3)
    .map((quest) => ({
      questId: quest.id,
      title: quest.title,
      reason: blockedQuestIds.has(quest.id)
        ? "This quest is linked to an active blocker, so unblock wording comes first."
        : quest.status === "in_progress"
          ? "This is already in motion, so it is the easiest place to restart."
          : "This is the clearest next step with the lowest friction today.",
      focusMinutes: quest.estimatedMinutes ?? 45,
      successHint: quest.description || "Shrink the work until the finish line is visible.",
      status: quest.status,
    }));
}

export function buildDashboardStats(quests: Quest[], blockers: Blocker[], events: QuestEvent[]) {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    activeQuestCount: quests.filter((quest) => quest.status !== "completed").length,
    completedThisWeek: events.filter(
      (event) => event.type === "quest_completed" && new Date(event.createdAt).getTime() >= oneWeekAgo,
    ).length,
    openBlockerCount: blockers.filter((blocker) => blocker.status === "open").length,
  };
}

export function enrichState(state: PersistedState): AppState {
  const portfolioSettings: PortfolioSettings = {
    ...defaultPortfolioSettings(),
    ...(state.portfolioSettings ?? {}),
    wipLimit: clampWipLimit(state.portfolioSettings?.wipLimit),
  };

  const uiPreferences: UiPreferences = {
    ...defaultUiPreferences(),
    ...(state.uiPreferences ?? {}),
  };

  const rawState: PersistedState = {
    ...emptyPersistedState(),
    ...state,
    userProfile: state.userProfile ?? defaultUserProfile(),
    uiPreferences,
    portfolioSettings,
    resumeQueueItems: state.resumeQueueItems ?? [],
    workSessions: state.workSessions ?? [],
    metaWorkFlags: state.metaWorkFlags ?? [],
    bottleneckInterviews: state.bottleneckInterviews ?? [],
    buildImproveDecisions: state.buildImproveDecisions ?? [],
    returnRuns: state.returnRuns ?? [],
    leadMetricsDaily: state.leadMetricsDaily ?? [],
  };

  const tracking = rebuildTrackingCollections(rawState);
  const safeState: PersistedState = {
    ...rawState,
    metaWorkFlags: tracking.metaWorkFlags,
    leadMetricsDaily: tracking.leadMetricsDaily,
  };

  const focusGoal = findFocusGoal(safeState.goals, portfolioSettings);
  const waitingGoalIds = new Set(safeState.resumeQueueItems.filter((item) => item.status === "waiting").map((item) => item.goalId));
  const activeGoals = prioritizeFocusGoal(safeState.goals.filter((goal) => goal.status === "active"), focusGoal);
  const parkedGoals = sortGoals(safeState.goals.filter((goal) => waitingGoalIds.has(goal.id)));
  const currentMilestones = focusGoal
    ? safeState.milestones.filter((milestone) => milestone.goalId === focusGoal.id).sort((left, right) => left.sequence - right.sequence)
    : [];
  const currentQuests = focusGoal
    ? safeState.quests.filter((quest) => quest.goalId === focusGoal.id).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    : [];
  const currentBlockers = focusGoal
    ? safeState.blockers.filter((blocker) => blocker.goalId === focusGoal.id).sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))
    : [];
  const currentReviews = focusGoal
    ? safeState.reviews.filter((review) => review.goalId === focusGoal.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    : [];
  const resumeQueue = buildResumeQueueEntries(safeState);
  const stats = buildDashboardStats(safeState.quests, safeState.blockers, safeState.events);
  const currentWorkSession = [...safeState.workSessions]
    .filter((session) => !session.endedAt)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null;
  const todayKey = dayKeyFromIso(nowIso());
  const todayWorkSessions = sortSessions(safeState.workSessions.filter((session) => dayKeyFromIso(session.startedAt) === todayKey));
  const todayLeadMetrics = safeState.leadMetricsDaily.find((item) => item.dayKey === todayKey) ?? null;
  const todayMetaWorkFlags = safeState.metaWorkFlags.filter((item) => item.dayKey === todayKey);
  const latestBuildImproveDecision: BuildImproveDecision | null = [...safeState.buildImproveDecisions]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const latestBottleneckInterview = [...safeState.bottleneckInterviews]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const latestReturnRun = [...safeState.returnRuns].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;

  return {
    ...safeState,
    focusGoal,
    currentGoal: focusGoal,
    activeGoals,
    parkedGoals,
    resumeQueue,
    portfolioStats: {
      totalGoals: safeState.goals.filter((goal) => isRunnableGoal(goal) || waitingGoalIds.has(goal.id)).length,
      activeGoalCount: activeGoals.length,
      parkedGoalCount: parkedGoals.length,
      resumeQueueCount: resumeQueue.length,
      wipLimit: portfolioSettings.wipLimit,
      availableSlots: Math.max(0, portfolioSettings.wipLimit - activeGoals.length),
    },
    switchSummary: buildSwitchSummary(safeState),
    currentMilestones,
    currentQuests,
    currentBlockers,
    currentReviews,
    todaySuggestions: buildTodaySuggestions(currentQuests, currentBlockers),
    stats: {
      ...stats,
      milestoneCount: currentMilestones.length,
    },
    recentEvents: [...safeState.events].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 12),
    currentWorkSession,
    todayWorkSessions,
    latestBuildImproveDecision,
    latestBottleneckInterview,
    latestReturnRun,
    todayLeadMetrics,
    todayMetaWorkFlags,
    mirrorCard: buildMirrorCard(safeState),
  };
}

export function buildHeuristicIntakeRefinement(input: {
  title: string;
  description: string;
  why: string;
  deadline: string | null | undefined;
  successCriteria: string[];
  currentState: string;
  constraints: string[];
  concerns: string;
}): IntakeRefinement {
  const successCriteria = input.successCriteria.length
    ? input.successCriteria
    : [
        "You can explain what done looks like in one sentence.",
        "You can show a concrete artifact or output.",
        "You leave evidence that helps the next decision.",
      ];

  const constraintsToWatch = input.constraints.length
    ? input.constraints
    : ["Available time", "Decision waiting", "Unclear next step"];

  return {
    goalTitle: input.title,
    goalSummary:
      input.description ||
      `${input.title} needs to move from an ambitious idea into an executable route${input.deadline ? ` by ${input.deadline}` : ""}.`,
    successCriteria,
    constraintsToWatch,
    openQuestions: [
      input.currentState ? `Current state: ${input.currentState}` : "What is already true right now?",
      input.concerns ? `Main concern: ${input.concerns}` : "Where are you most likely to stall?",
      "What is the smallest thing you could show this week?",
    ],
    firstRouteNote: "Start with a route you can actually begin, not the perfect plan.",
    mode: "heuristic",
  };
}

export function buildHeuristicMapDraft(goal: Goal): MapDraft {
  const deadlineLabel = goal.deadline ?? "the current working window";
  return {
    routeSummary: `Move ${goal.title} through three stages before ${deadlineLabel}: clarify the route, build the core, then polish and share.`,
    milestones: [
      {
        tempId: makeId(),
        title: "Clarify the route",
        description: "Reduce ambiguity around the goal, the constraints, and the finish line.",
        targetDate: goal.deadline,
        quests: [
          {
            title: "Lock the win conditions",
            description: "Turn success criteria into a short checklist.",
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 30,
            questType: "main",
          },
          {
            title: "Write the current-state snapshot",
            description: goal.currentState || "Summarize what is already done and what is still fuzzy.",
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 25,
            questType: "main",
          },
        ],
      },
      {
        tempId: makeId(),
        title: "Build the core",
        description: "Do the smallest slice that proves the route works.",
        targetDate: goal.deadline,
        quests: [
          {
            title: "Ship the smallest visible output",
            description: "Choose one artifact that would prove movement this week.",
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 45,
            questType: "main",
          },
          {
            title: "Remove the loudest blocker",
            description: "If something would stop execution, shrink or reroute it now.",
            priority: "medium",
            dueDate: goal.deadline,
            estimatedMinutes: 30,
            questType: "side",
          },
        ],
      },
      {
        tempId: makeId(),
        title: "Polish and share",
        description: "Tighten the route and make the work easy to resume or explain.",
        targetDate: goal.deadline,
        quests: [
          {
            title: "Capture learnings and next steps",
            description: "Leave notes that make the next restart cheaper.",
            priority: "medium",
            dueDate: goal.deadline,
            estimatedMinutes: 20,
            questType: "side",
          },
        ],
      },
    ],
    mode: "heuristic",
  };
}

export function buildHeuristicTodayPlan(
  inputOrGoal: { goal: Goal; quests: Quest[]; blockers: Blocker[]; review?: Review | null } | Goal,
  questsArg?: Quest[],
  blockersArg?: Blocker[],
  reviewArg?: Review | null,
): TodayPlan {
  const input = "goal" in inputOrGoal
    ? inputOrGoal
    : { goal: inputOrGoal, quests: questsArg ?? [], blockers: blockersArg ?? [], review: reviewArg ?? null };
  const suggestions = buildTodaySuggestions(input.quests, input.blockers);
  return {
    theme: input.review?.nextFocus || `Keep ${input.goal.title} moving with the clearest visible next step.`,
    quests: suggestions,
    notes: [
      input.goal.todayCapacity ? `Today's capacity: ${input.goal.todayCapacity}` : "Plan one clean work block first.",
      input.blockers.length ? "One suggestion may need unblock wording before building." : "No active blocker is recorded right now.",
    ],
    mode: "heuristic",
  };
}

export function buildHeuristicBlockerReroute(goal: Goal, blocker: { title: string; description: string; blockerType: string }): BlockerReroute {
  return {
    blockerLabel: blocker.title,
    diagnosis: blocker.description || `${blocker.blockerType} is slowing ${goal.title}.`,
    nextStep: "Shrink the blocker into one decision or one question you can answer now.",
    alternateRoute: "If the blocker stays, route around it with a smaller proof step.",
    reframing: "The goal does not need the full solution before the next move becomes valid.",
    mode: "heuristic",
  };
}
