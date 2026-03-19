import {
  type AppState,
  type Blocker,
  type BlockerReroute,
  type Goal,
  type IntakeRefinement,
  type MapDraft,
  type PersistedState,
  type Quest,
  type QuestEvent,
  type Review,
  type TodayPlan,
  type TodayQuestSuggestion,
  type UserProfile,
} from "@/lib/quest-agent/types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(): string {
  return crypto.randomUUID();
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

export function pickCurrentGoal(goals: Goal[]): Goal | null {
  const sorted = [...goals].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return sorted.find((goal) => goal.status === "active") ?? sorted[0] ?? null;
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
  const currentGoal = pickCurrentGoal(state.goals);
  const currentMilestones = currentGoal
    ? state.milestones.filter((milestone) => milestone.goalId === currentGoal.id).sort((left, right) => left.sequence - right.sequence)
    : [];
  const currentQuests = currentGoal
    ? state.quests.filter((quest) => quest.goalId === currentGoal.id).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    : [];
  const currentBlockers = currentGoal
    ? state.blockers.filter((blocker) => blocker.goalId === currentGoal.id).sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))
    : [];
  const currentReviews = currentGoal
    ? state.reviews.filter((review) => review.goalId === currentGoal.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    : [];
  const stats = buildDashboardStats(currentQuests, currentBlockers, state.events);

  return {
    ...state,
    userProfile: state.userProfile ?? defaultUserProfile(),
    currentGoal,
    currentMilestones,
    currentQuests,
    currentBlockers,
    currentReviews,
    todaySuggestions: buildTodaySuggestions(currentQuests, currentBlockers),
    stats: {
      ...stats,
      milestoneCount: currentMilestones.length,
    },
    recentEvents: [...state.events].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8),
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
            estimatedMinutes: 30,
            questType: "main",
          },
        ],
      },
      {
        tempId: makeId(),
        title: "Build the core",
        description: "Create the smallest version that proves the route is viable.",
        targetDate: goal.deadline,
        quests: [
          {
            title: `Build the core of ${goal.title}`,
            description: goal.description || "Make the smallest artifact you can show to someone else.",
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 60,
            questType: "main",
          },
          {
            title: "Name likely blockers early",
            description: goal.concerns || "Write down the blockers that would stop momentum.",
            priority: "medium",
            dueDate: goal.deadline,
            estimatedMinutes: 25,
            questType: "side",
          },
        ],
      },
      {
        tempId: makeId(),
        title: "Polish and reroute",
        description: "Review progress, tighten the route, and prepare the next stretch.",
        targetDate: goal.deadline,
        quests: [
          {
            title: "Share a progress artifact",
            description: "Pick one person or one place where the current progress can be shown.",
            priority: "medium",
            dueDate: goal.deadline,
            estimatedMinutes: 30,
            questType: "main",
          },
          {
            title: "Write a weekly review",
            description: "Capture what worked, what stalled, and what should change next.",
            priority: "medium",
            dueDate: goal.deadline,
            estimatedMinutes: 30,
            questType: "side",
          },
        ],
      },
    ],
    mode: "heuristic",
  };
}

export function buildHeuristicTodayPlan(goal: Goal, quests: Quest[], blockers: Blocker[], review: Review | undefined): TodayPlan {
  const questSuggestions = buildTodaySuggestions(quests, blockers);
  const notes = [
    goal.todayCapacity ? `Today's capacity: ${goal.todayCapacity}` : "Bias toward a 25-minute block if energy is unclear.",
    blockers.some((blocker) => blocker.status === "open")
      ? "There is at least one open blocker, so include one unblock step in today's route."
      : "No major blocker is visible, so favor the clearest direct step.",
  ];

  if (review?.rerouteNote) {
    notes.push(`Last reroute note: ${review.rerouteNote}`);
  }

  return {
    theme: "Today is about protecting momentum with one concrete forward move.",
    quests: questSuggestions.length
      ? questSuggestions
      : [
          {
            questId: null,
            title: "Create the Quest Map",
            reason: "There is no saved route yet, so the next best move is to define one.",
            focusMinutes: 30,
            successHint: "Keep it to three milestones and save the draft.",
            status: "suggested",
          },
        ],
    notes,
    mode: "heuristic",
  };
}

export function buildHeuristicBlockerReroute(goal: Goal, blocker: { title: string; description: string; blockerType: string }): BlockerReroute {
  return {
    blockerLabel: blocker.title,
    diagnosis:
      blocker.description ||
      `${goal.title} is currently stalled because the next concrete step is still too fuzzy or too large.`,
    nextStep: "Shrink the problem to one action that can finish in 10 to 25 minutes.",
    alternateRoute: "If the direct route still feels heavy, switch to a smaller evidence-producing side quest.",
    reframing: "This is not a motivation failure. It is a sign that the route needs a smaller step size.",
    mode: "heuristic",
  };
}