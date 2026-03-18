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
  ReviewFocusCandidateInput,
  ReviewFocusCandidateReason,
  SwitchSummary,
  TodayPlan,
  TodayQuestSuggestion,
  UiLocale,
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

function getTodaySuggestionReason(quest: Quest, isBlocked: boolean, locale: UiLocale): string {
  if (isBlocked) {
    return locale === "ja"
      ? "この作業は未解決の詰まりにつながっている。先に言葉をほどくと進めやすい。"
      : "This quest is linked to an active blocker, so unblock wording comes first.";
  }

  if (quest.status === "in_progress") {
    return locale === "ja"
      ? "すでに動いている。いちばん戻りやすい場所から再開する。"
      : "This is already in motion, so it is the easiest place to restart.";
  }

  return locale === "ja"
    ? "次の一手が見えていて、今日の摩擦が少ない。"
    : "This is the clearest next step with the lowest friction today.";
}

function getTodaySuggestionHint(description: string, locale: UiLocale): string {
  return description || (locale === "ja" ? "終わりが見える大きさまで小さくする。" : "Shrink the work until the finish line is visible.");
}

export function buildTodaySuggestions(quests: Quest[], blockers: Blocker[], locale: UiLocale = "ja"): TodayQuestSuggestion[] {
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
      reason: getTodaySuggestionReason(quest, blockedQuestIds.has(quest.id), locale),
      focusMinutes: quest.estimatedMinutes ?? 45,
      successHint: getTodaySuggestionHint(quest.description, locale),
      status: quest.status,
    }));
}

export function findLatestArtifactNoteForGoal(workSessions: WorkSession[], goalId: string): string {
  return [...workSessions]
    .filter((session) => session.goalId === goalId && Boolean(session.endedAt) && session.artifactNote.trim().length > 0)
    .sort((left, right) => (right.endedAt ?? right.startedAt).localeCompare(left.endedAt ?? left.startedAt))[0]?.artifactNote.trim() ?? "";
}

export function findLatestDoneWhenForGoal(buildImproveDecisions: BuildImproveDecision[], goalId: string): string {
  return [...buildImproveDecisions]
    .filter((decision) => decision.goalId === goalId && decision.doneWhen.trim().length > 0)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.doneWhen.trim() ?? "";
}

function reviewFocusCandidateRank(candidate: ReviewFocusCandidateInput): number {
  if (candidate.isInResumeQueue && candidate.isOverdue) {
    return 0;
  }
  if (candidate.isInResumeQueue) {
    return 1;
  }
  if (candidate.status === "active" && candidate.activeQuestCount > 0) {
    return 2;
  }
  return 3;
}

export function buildReviewFocusCandidates(state: AppState): ReviewFocusCandidateInput[] {
  const focusGoalId = state.focusGoal?.id ?? null;
  const waitingQueue = new Map(state.resumeQueue.map((item) => [item.goalId, item]));
  const candidates = state.goals
    .filter((goal) => goal.status !== "completed")
    .map((goal) => ({
      goalId: goal.id,
      title: goal.title,
      description: goal.description,
      currentState: goal.currentState,
      status: goal.status,
      isInResumeQueue: waitingQueue.has(goal.id),
      isOverdue: waitingQueue.get(goal.id)?.isOverdue ?? false,
      openBlockerCount: state.blockers.filter((blocker) => blocker.goalId === goal.id && blocker.status === "open").length,
      activeQuestCount: state.quests.filter((quest) => quest.goalId === goal.id && (quest.status === "ready" || quest.status === "in_progress")).length,
      updatedAt: goal.updatedAt,
    }))
    .sort((left, right) => {
      const rankDelta = reviewFocusCandidateRank(left) - reviewFocusCandidateRank(right);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  const alternatives = focusGoalId ? candidates.filter((candidate) => candidate.goalId !== focusGoalId) : candidates;
  const visible = alternatives.length > 0 ? alternatives : candidates;
  return visible.slice(0, 4);
}

function getHeuristicReviewReason(candidate: ReviewFocusCandidateInput, locale: UiLocale): string {
  if (candidate.isInResumeQueue && candidate.isOverdue) {
    return locale === "ja"
      ? "再開条件がそろっていて、戻り先も決まっている。"
      : "Its restart condition has arrived and the return path is already clear.";
  }

  if (candidate.isInResumeQueue) {
    return locale === "ja"
      ? "再開メモがあり、戻る負担が小さい。"
      : "It already has a restart note, so the return cost is low.";
  }

  if (candidate.status === "active" && candidate.activeQuestCount > 0 && candidate.openBlockerCount <= 1) {
    return locale === "ja"
      ? "いま動かせる次の一手が見えている。"
      : "Its next move is visible right now.";
  }

  if (candidate.status === "active" && candidate.openBlockerCount > 1) {
    return locale === "ja"
      ? "詰まりはあるが、見直すと前進に戻しやすい。"
      : "It has blockers, but a review could bring it back into forward motion.";
  }

  return locale === "ja"
    ? "今週のメインクエスト候補として整理しやすい。"
    : "This looks easy to organize as a front-slot candidate this week.";
}

export function buildHeuristicReviewFocusReasons(candidates: ReviewFocusCandidateInput[], locale: UiLocale = "ja"): ReviewFocusCandidateReason[] {
  return candidates.map((candidate) => ({
    goalId: candidate.goalId,
    reason: getHeuristicReviewReason(candidate, locale),
    mode: "heuristic",
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
    todaySuggestions: buildTodaySuggestions(currentQuests, currentBlockers, uiPreferences.locale),
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
    mirrorCard: buildMirrorCard(safeState, uiPreferences.locale),
  };
}

function getDefaultSuccessCriteria(locale: UiLocale): string[] {
  return locale === "ja"
    ? [
        "終わったと言える形を一文で言える。",
        "外に出せる成果が一つある。",
        "次の判断に使える手がかりが残る。",
      ]
    : [
        "You can explain what done looks like in one sentence.",
        "You can show one concrete artifact or output.",
        "You leave evidence that helps the next decision.",
      ];
}

function getDefaultConstraints(locale: UiLocale): string[] {
  return locale === "ja"
    ? ["使える時間", "待っている判断", "次の一手のあいまいさ"]
    : ["Available time", "Decision waiting", "Unclear next step"];
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
}, locale: UiLocale = "ja"): IntakeRefinement {
  const successCriteria = input.successCriteria.length ? input.successCriteria : getDefaultSuccessCriteria(locale);
  const constraintsToWatch = input.constraints.length ? input.constraints : getDefaultConstraints(locale);
  const deadlinePhrase = input.deadline ? (locale === "ja" ? `${input.deadline} までに` : ` by ${input.deadline}`) : "";

  return {
    goalTitle: input.title,
    goalSummary:
      input.description ||
      (locale === "ja"
        ? `${input.title} を${deadlinePhrase}手をつけられる進め方へ整える。`
        : `${input.title} needs to move from an ambitious idea into an executable route${deadlinePhrase}.`),
    successCriteria,
    constraintsToWatch,
    openQuestions: [
      input.currentState
        ? (locale === "ja" ? `現状: ${input.currentState}` : `Current state: ${input.currentState}`)
        : (locale === "ja" ? "いま既に成り立っていることは何ですか。" : "What is already true right now?"),
      input.concerns
        ? (locale === "ja" ? `いちばん気になる点: ${input.concerns}` : `Main concern: ${input.concerns}`)
        : (locale === "ja" ? "どこでいちばん止まりやすそうですか。" : "Where are you most likely to stall?"),
      locale === "ja" ? "今週見せられる最小の前進は何ですか。" : "What is the smallest thing you could show this week?",
    ],
    firstRouteNote: locale === "ja"
      ? "完璧な計画ではなく、今日から始められる進め方から作る。"
      : "Start with a route you can actually begin, not the perfect plan.",
    mode: "heuristic",
  };
}

export function buildHeuristicMapDraft(goal: Goal, locale: UiLocale = "ja"): MapDraft {
  const deadlineLabel = goal.deadline ?? (locale === "ja" ? "いまの作業期間" : "the current working window");
  return {
    routeSummary: locale === "ja"
      ? `${goal.title} を ${deadlineLabel} に向けて進めるために、進め方を固める、本体を動かす、整えて共有する、の 3 段階で進める。`
      : `Move ${goal.title} through three stages before ${deadlineLabel}: clarify the route, build the core, then polish and share.`,
    milestones: [
      {
        tempId: makeId(),
        title: locale === "ja" ? "進め方を固める" : "Clarify the route",
        description: locale === "ja" ? "ゴール、制約、終わり方の曖昧さを減らす。" : "Reduce ambiguity around the goal, the constraints, and the finish line.",
        targetDate: goal.deadline,
        quests: [
          {
            title: locale === "ja" ? "勝ち筋を固定する" : "Lock the win conditions",
            description: locale === "ja" ? "終わったと言える条件を短いチェックリストにする。" : "Turn success criteria into a short checklist.",
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 30,
            questType: "main",
          },
          {
            title: locale === "ja" ? "現状をひと目で分かる形にする" : "Write the current-state snapshot",
            description: goal.currentState || (locale === "ja" ? "できていることと曖昧な点を短く整理する。" : "Summarize what is already done and what is still fuzzy."),
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 25,
            questType: "main",
          },
        ],
      },
      {
        tempId: makeId(),
        title: locale === "ja" ? "本体を動かす" : "Build the core",
        description: locale === "ja" ? "進め方が合っていると分かる最小の一片を動かす。" : "Do the smallest slice that proves the route works.",
        targetDate: goal.deadline,
        quests: [
          {
            title: locale === "ja" ? "最小の見える成果を出す" : "Ship the smallest visible output",
            description: locale === "ja" ? "今週の前進を示せる成果物を一つ選ぶ。" : "Choose one artifact that would prove movement this week.",
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 45,
            questType: "main",
          },
          {
            title: locale === "ja" ? "いちばん大きい詰まりを下げる" : "Remove the loudest blocker",
            description: locale === "ja" ? "実行を止めるものがあれば、いま小さくするか迂回する。" : "If something would stop execution, shrink or reroute it now.",
            priority: "medium",
            dueDate: goal.deadline,
            estimatedMinutes: 30,
            questType: "side",
          },
        ],
      },
      {
        tempId: makeId(),
        title: locale === "ja" ? "整えて共有する" : "Polish and share",
        description: locale === "ja" ? "再開しやすく、人にも説明しやすい形に整える。" : "Tighten the route and make the work easy to resume or explain.",
        targetDate: goal.deadline,
        quests: [
          {
            title: locale === "ja" ? "学びと次の一手を残す" : "Capture learnings and next steps",
            description: locale === "ja" ? "次回の再開コストが下がるメモを残す。" : "Leave notes that make the next restart cheaper.",
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
  locale: UiLocale = "ja",
): TodayPlan {
  const input = "goal" in inputOrGoal
    ? inputOrGoal
    : { goal: inputOrGoal, quests: questsArg ?? [], blockers: blockersArg ?? [], review: reviewArg ?? null };
  const suggestions = buildTodaySuggestions(input.quests, input.blockers, locale);

  return {
    theme: input.review?.nextFocus || (locale === "ja" ? `${input.goal.title} を、いま見えている次の一手から進める。` : `Keep ${input.goal.title} moving with the clearest visible next step.`),
    quests: suggestions,
    notes: [
      input.goal.todayCapacity
        ? (locale === "ja" ? `今日の使える時間: ${input.goal.todayCapacity}` : `Today's capacity: ${input.goal.todayCapacity}`)
        : (locale === "ja" ? "まずは 1 本だけ、時間を切った作業枠を置く。" : "Plan one clean work block first."),
      input.blockers.length
        ? (locale === "ja" ? "始める前に、詰まりをほどく言い方が必要な候補がある。" : "One suggestion may need unblock wording before building.")
        : (locale === "ja" ? "いま未解決の詰まりは記録されていない。" : "No active blocker is recorded right now."),
    ],
    mode: "heuristic",
  };
}

export function buildHeuristicBlockerReroute(goal: Goal, blocker: { title: string; description: string; blockerType: string }, locale: UiLocale = "ja"): BlockerReroute {
  return {
    blockerLabel: blocker.title,
    diagnosis: blocker.description || (locale === "ja" ? `${goal.title} は ${blocker.blockerType} が引っかかって進みが鈍っている。` : `${blocker.blockerType} is slowing ${goal.title}.`),
    nextStep: locale === "ja" ? "この詰まりを、いま答えられる一つの判断か一つの問いに縮める。" : "Shrink the blocker into one decision or one question you can answer now.",
    alternateRoute: locale === "ja" ? "まだ残るなら、小さく証明できる別ルートで先に進む。" : "If the blocker stays, route around it with a smaller proof step.",
    reframing: locale === "ja" ? "次の一手が有効になる前に、全部を解く必要はない。" : "The goal does not need the full solution before the next move becomes valid.",
    mode: "heuristic",
  };
}
