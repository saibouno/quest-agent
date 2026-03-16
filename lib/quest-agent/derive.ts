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
} from "@/lib/quest-agent/types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(): string {
  return crypto.randomUUID();
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
  const blockedQuestIds = new Set(blockers.filter((blocker) => blocker.status === "open" && blocker.relatedQuestId).map((blocker) => blocker.relatedQuestId));
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
      const minutesLeft = left.estimatedMinutes ?? 45;
      const minutesRight = right.estimatedMinutes ?? 45;
      return minutesLeft - minutesRight;
    })
    .slice(0, 3)
    .map((quest) => ({
      questId: quest.id,
      title: quest.title,
      reason: blockedQuestIds.has(quest.id)
        ? "詰まりをほどく補助が必要です。先に blocker を言語化して進み方を軽くします。"
        : quest.status === "in_progress"
          ? "途中で止まっているので、再始動の摩擦が一番低い quest です。"
          : "今日の前進に直結しやすい quest として選びました。",
      focusMinutes: quest.estimatedMinutes ?? 45,
      successHint: quest.description || "終わりが見えるサイズに切って着手します。",
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
    ? state.quests
        .filter((quest) => quest.goalId === currentGoal.id)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    : [];
  const currentBlockers = currentGoal
    ? state.blockers
        .filter((blocker) => blocker.goalId === currentGoal.id)
        .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))
    : [];
  const currentReviews = currentGoal
    ? state.reviews
        .filter((review) => review.goalId === currentGoal.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    : [];
  const stats = buildDashboardStats(currentQuests, currentBlockers, state.events);

  return {
    ...state,
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
        "完成の定義を1文で言える",
        "他人に見せられる状態まで持っていく",
        "次の判断に必要な証拠が残る",
      ];
  const constraintsToWatch = input.constraints.length ? input.constraints : ["使える時間", "意思決定待ち", "不明点の放置"];
  return {
    goalTitle: input.title,
    goalSummary:
      input.description ||
      `${input.title} を、${input.deadline ? `${input.deadline} までに` : "現実的な期限で"}前に進める。Why は「${input.why || "前に進めたい理由を言語化する"}」です。`,
    successCriteria,
    constraintsToWatch,
    openQuestions: [
      input.currentState ? `現在地の要点: ${input.currentState}` : "いま何が既にできているかを短く定義する",
      input.concerns ? `一番気になる不安: ${input.concerns}` : "止まりやすい箇所を1つ選ぶ",
      "今週中に見せられる最小成果物は何かを決める",
    ],
    firstRouteNote: "最初は完璧な計画より、3段階の route と最初の 1 手を決めることを優先します。",
    mode: "heuristic",
  };
}

export function buildHeuristicMapDraft(goal: Goal): MapDraft {
  const deadlineLabel = goal.deadline ?? "未設定";
  return {
    routeSummary: `Goal を 3 段階に分け、${deadlineLabel} に向けて「方向を固める -> 形にする -> 仕上げる」の流れで進めます。`,
    milestones: [
      {
        tempId: makeId(),
        title: "Route を固める",
        description: "勝ち条件、現在地、優先順位を整理して迷いを減らす段階。",
        targetDate: goal.deadline,
        quests: [
          {
            title: "勝ち条件を3つに絞る",
            description: "この goal が前進したと言える条件を明文化する。",
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 30,
            questType: "main",
          },
          {
            title: "今の現在地を1画面にまとめる",
            description: goal.currentState || "いま持っている材料、足りない情報、未決定事項を整理する。",
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 40,
            questType: "main",
          },
        ],
      },
      {
        tempId: makeId(),
        title: "Core を作る",
        description: "一番価値が出る中心部分を先に形にする段階。",
        targetDate: goal.deadline,
        quests: [
          {
            title: `${goal.title} の中心成果を作る`,
            description: goal.description || "ユーザーに見せられる最小成果物を作る。",
            priority: "high",
            dueDate: goal.deadline,
            estimatedMinutes: 90,
            questType: "main",
          },
          {
            title: "Blocker 候補を先に潰す",
            description: goal.concerns || "今詰まりそうな点を1つ潰す。",
            priority: "medium",
            dueDate: goal.deadline,
            estimatedMinutes: 45,
            questType: "side",
          },
        ],
      },
      {
        tempId: makeId(),
        title: "仕上げて見せる",
        description: "振り返りと仕上げを入れて、他人に見せられる形にする段階。",
        targetDate: goal.deadline,
        quests: [
          {
            title: "見せる相手を決めて共有する",
            description: "成果物を誰に見せるかを決め、実際に共有する。",
            priority: "medium",
            dueDate: goal.deadline,
            estimatedMinutes: 30,
            questType: "main",
          },
          {
            title: "週次 review を書いて route を直す",
            description: "うまくいったこと、止まった理由、次の重点を整理する。",
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
    goal.todayCapacity ? `今日使える余力: ${goal.todayCapacity}` : "最初の 25 分で動き出せる quest から始めます。",
    blockers.some((blocker) => blocker.status === "open")
      ? "open blocker があるので、詰まりをほどく一手を今日の route に含めます。"
      : "大きな blocker は見えていないので、着手しやすい順で進めます。",
  ];
  if (review?.rerouteNote) {
    notes.push(`前回の reroute: ${review.rerouteNote}`);
  }

  return {
    theme: "今日は momentum を落とさず、最小の前進を 1 つ確実に作る日です。",
    quests: questSuggestions.length
      ? questSuggestions
      : [
          {
            questId: null,
            title: "Quest Map を作る",
            reason: "まだ quest が定義されていないため、先に route を作るのが最短です。",
            focusMinutes: 30,
            successHint: "milestone を 3 つまでに絞って保存します。",
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
      `${goal.title} に対して、次の一手が不明なまま止まっています。大きい判断を一度に片付けようとしている可能性があります。`,
    nextStep: "まずは 25 分以内に終わる確認・整理・問い合わせのどれか 1 つに分解します。",
    alternateRoute: "本命が重い場合は、証拠を増やす軽い side quest に切り替えて momentum を維持します。",
    reframing: "止まったのは根性不足ではなく、route の粒度が大きすぎるサインとして扱います。",
    mode: "heuristic",
  };
}
