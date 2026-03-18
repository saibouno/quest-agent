"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";

import {
  createBlockerInBrowser,
  createReviewInBrowser,
  finishWorkSessionInBrowser,
  parkGoalInBrowser,
  readBrowserAppState,
  recordBuildImproveDecisionInBrowser,
  recordReturnInterviewInBrowser,
  recordReturnRunInBrowser,
  recordTodayPlanInBrowser,
  replaceMapInBrowser,
  resumeGoalInBrowser,
  saveGoalInBrowser,
  selectFocusGoalInBrowser,
  startWorkSessionInBrowser,
  updatePortfolioSettingsInBrowser,
  updateQuestStatusInBrowser,
  updateUiPreferencesInBrowser,
} from "@/lib/quest-agent/browser-store";
import { buildHeuristicBlockerReroute, buildHeuristicReviewFocusReasons } from "@/lib/quest-agent/derive";
import type {
  AppState,
  BackendModeLabel,
  Blocker,
  BlockerInput,
  BlockerReroute,
  BottleneckInterview,
  BuildImproveCheckInput,
  BuildImproveDecision,
  ClientStorageHint,
  ClientStorageMode,
  FocusGoalInput,
  GenerateMapInput,
  Goal,
  GoalInput,
  IntakeRefineInput,
  IntakeRefinement,
  MapDraft,
  MapInput,
  ParkGoalInput,
  PlanTodayInput,
  PortfolioSettings,
  PortfolioSettingsInput,
  Quest,
  QuestStatus,
  ResumeGoalInput,
  Review,
  ReviewInput,
  RerouteInput,
  ReturnInterviewInput,
  ReturnRun,
  ReturnRunInput,
  ReviewFocusCandidateReason,
  ReviewFocusReasonsInput,
  TodayPlan,
  UiPreferences,
  UiPreferencesInput,
  WorkSession,
  WorkSessionFinishInput,
  WorkSessionStartInput,
} from "@/lib/quest-agent/types";

interface QuestAgentContextValue {
  state: AppState;
  clientStorageMode: ClientStorageMode;
  backendMode: BackendModeLabel;
  aiMode: "ai" | "heuristic";
  aiEnabled: boolean;
  saveGoal: (input: GoalInput) => Promise<Goal>;
  replaceMap: (input: MapInput) => Promise<void>;
  updateQuestStatus: (questId: string, status: QuestStatus) => Promise<Quest>;
  createBlocker: (input: Omit<BlockerInput, "suggestedNextStep">) => Promise<{ blocker: Blocker; reroute: BlockerReroute }>;
  createReview: (input: ReviewInput) => Promise<Review>;
  updatePortfolioSettings: (input: PortfolioSettingsInput) => Promise<PortfolioSettings>;
  updateUiPreferences: (input: UiPreferencesInput) => Promise<UiPreferences>;
  selectFocusGoal: (input: FocusGoalInput) => Promise<Goal>;
  parkGoal: (input: ParkGoalInput) => Promise<Goal>;
  resumeGoal: (input: ResumeGoalInput) => Promise<Goal>;
  buildImproveCheck: (input: BuildImproveCheckInput) => Promise<BuildImproveDecision>;
  startWorkSession: (input: WorkSessionStartInput) => Promise<WorkSession>;
  finishWorkSession: (input: WorkSessionFinishInput) => Promise<WorkSession>;
  saveReturnInterview: (input: ReturnInterviewInput) => Promise<BottleneckInterview>;
  saveReturnRun: (input: ReturnRunInput) => Promise<ReturnRun>;
  refineIntake: (input: IntakeRefineInput) => Promise<IntakeRefinement>;
  generateMap: (input: GenerateMapInput) => Promise<MapDraft>;
  planToday: (input: PlanTodayInput) => Promise<TodayPlan>;
  rerouteFromBlocker: (input: RerouteInput) => Promise<BlockerReroute>;
  generateReviewFocusReasons: (input: ReviewFocusReasonsInput) => Promise<ReviewFocusCandidateReason[]>;
}

const QuestAgentContext = createContext<QuestAgentContextValue | null>(null);

async function fetchJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }

  return body;
}

export function QuestAgentProvider({
  children,
  initialState,
  storageHint,
  initialBackendMode,
  aiMode,
}: PropsWithChildren<{
  initialState: AppState;
  storageHint: ClientStorageHint;
  initialBackendMode: BackendModeLabel;
  aiMode: "ai" | "heuristic";
}>) {
  const [state, setState] = useState(initialState);
  const clientStorageMode: ClientStorageMode = storageHint;

  useEffect(() => {
    if (clientStorageMode !== "browser-local") {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setState(readBrowserAppState());
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [clientStorageMode]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.lang = state.uiPreferences.locale;
  }, [state.uiPreferences.locale]);

  function refreshBrowserState() {
    setState(readBrowserAppState());
  }

  async function saveGoal(input: GoalInput): Promise<Goal> {
    if (clientStorageMode === "browser-local") {
      const goal = saveGoalInBrowser(input);
      refreshBrowserState();
      return goal;
    }

    const payload = await fetchJson<{ data: Goal }>("/api/goals", input);
    return payload.data;
  }

  async function replaceMap(input: MapInput): Promise<void> {
    if (clientStorageMode === "browser-local") {
      replaceMapInBrowser(input);
      refreshBrowserState();
      return;
    }

    await fetchJson<{ ok: boolean }>("/api/map", input);
  }

  async function updateQuestStatus(questId: string, status: QuestStatus): Promise<Quest> {
    if (clientStorageMode === "browser-local") {
      const quest = updateQuestStatusInBrowser(questId, status);
      refreshBrowserState();
      return quest;
    }

    const payload = await fetchJson<{ data: Quest }>("/api/quests/status", { questId, status });
    return payload.data;
  }

  async function updatePortfolioSettings(input: PortfolioSettingsInput): Promise<PortfolioSettings> {
    if (clientStorageMode === "browser-local") {
      const portfolioSettings = updatePortfolioSettingsInBrowser(input);
      refreshBrowserState();
      return portfolioSettings;
    }

    const payload = await fetchJson<{ data: PortfolioSettings }>("/api/portfolio/settings", input);
    return payload.data;
  }

  async function updateUiPreferences(input: UiPreferencesInput): Promise<UiPreferences> {
    if (clientStorageMode === "browser-local") {
      const uiPreferences = updateUiPreferencesInBrowser(input);
      refreshBrowserState();
      return uiPreferences;
    }

    const payload = await fetchJson<{ data: UiPreferences }>("/api/ui/preferences", input);
    setState((current) => ({ ...current, uiPreferences: payload.data }));
    return payload.data;
  }

  async function selectFocusGoal(input: FocusGoalInput): Promise<Goal> {
    if (clientStorageMode === "browser-local") {
      const goal = selectFocusGoalInBrowser(input);
      refreshBrowserState();
      return goal;
    }

    const payload = await fetchJson<{ data: Goal }>("/api/portfolio/focus", input);
    return payload.data;
  }

  async function parkGoal(input: ParkGoalInput): Promise<Goal> {
    if (clientStorageMode === "browser-local") {
      const goal = parkGoalInBrowser(input);
      refreshBrowserState();
      return goal;
    }

    const payload = await fetchJson<{ data: Goal }>("/api/portfolio/park", input);
    return payload.data;
  }

  async function resumeGoal(input: ResumeGoalInput): Promise<Goal> {
    if (clientStorageMode === "browser-local") {
      const goal = resumeGoalInBrowser(input);
      refreshBrowserState();
      return goal;
    }

    const payload = await fetchJson<{ data: Goal }>("/api/portfolio/resume", input);
    return payload.data;
  }

  async function buildImproveCheck(input: BuildImproveCheckInput): Promise<BuildImproveDecision> {
    if (clientStorageMode === "browser-local") {
      const decision = recordBuildImproveDecisionInBrowser(input);
      refreshBrowserState();
      return decision;
    }

    const payload = await fetchJson<{ data: BuildImproveDecision }>("/api/build-improve/check", input);
    return payload.data;
  }

  async function startWorkSession(input: WorkSessionStartInput): Promise<WorkSession> {
    if (clientStorageMode === "browser-local") {
      const session = startWorkSessionInBrowser(input);
      refreshBrowserState();
      return session;
    }

    const payload = await fetchJson<{ data: WorkSession }>("/api/work-sessions/start", input);
    return payload.data;
  }

  async function finishWorkSession(input: WorkSessionFinishInput): Promise<WorkSession> {
    if (clientStorageMode === "browser-local") {
      const session = finishWorkSessionInBrowser(input);
      refreshBrowserState();
      return session;
    }

    const payload = await fetchJson<{ data: WorkSession }>("/api/work-sessions/finish", input);
    return payload.data;
  }

  async function saveReturnInterview(input: ReturnInterviewInput): Promise<BottleneckInterview> {
    if (clientStorageMode === "browser-local") {
      const interview = recordReturnInterviewInBrowser(input);
      refreshBrowserState();
      return interview;
    }

    const payload = await fetchJson<{ data: BottleneckInterview }>("/api/return/interview", input);
    return payload.data;
  }

  async function saveReturnRun(input: ReturnRunInput): Promise<ReturnRun> {
    if (clientStorageMode === "browser-local") {
      const returnRun = recordReturnRunInBrowser(input);
      refreshBrowserState();
      return returnRun;
    }

    const payload = await fetchJson<{ data: ReturnRun }>("/api/return/run", input);
    return payload.data;
  }

  async function rerouteFromBlocker(input: RerouteInput): Promise<BlockerReroute> {
    if (clientStorageMode === "browser-local") {
      try {
        const payload = await fetchJson<{ data: BlockerReroute }>("/api/ai/reroute-from-blocker", {
          ...input,
          goalSnapshot: input.goalSnapshot ?? state.currentGoal,
          locale: input.locale ?? state.uiPreferences.locale,
        });
        return payload.data;
      } catch {
        const fallbackGoal = input.goalSnapshot ?? state.currentGoal;
        if (!fallbackGoal) {
          throw new Error("Goal not found.");
        }
        return buildHeuristicBlockerReroute(
          fallbackGoal,
          {
            title: input.title,
            description: input.description,
            blockerType: input.blockerType,
          },
          input.locale ?? state.uiPreferences.locale,
        );
      }
    }

    const payload = await fetchJson<{ data: BlockerReroute }>("/api/ai/reroute-from-blocker", {
      ...input,
      locale: input.locale ?? state.uiPreferences.locale,
    });
    return payload.data;
  }

  async function createBlocker(input: Omit<BlockerInput, "suggestedNextStep">): Promise<{ blocker: Blocker; reroute: BlockerReroute }> {
    if (clientStorageMode === "browser-local") {
      const reroute = await rerouteFromBlocker({
        goalId: input.goalId,
        goalSnapshot: state.currentGoal ?? undefined,
        title: input.title,
        description: input.description,
        blockerType: input.blockerType,
        relatedQuestId: input.relatedQuestId ?? null,
      });
      const blocker = createBlockerInBrowser({
        ...input,
        suggestedNextStep: `${reroute.nextStep} / ${reroute.alternateRoute}`,
      });
      refreshBrowserState();
      return { blocker, reroute };
    }

    const payload = await fetchJson<{ data: Blocker; reroute: BlockerReroute }>("/api/blockers", input);
    return {
      blocker: payload.data,
      reroute: payload.reroute,
    };
  }

  async function createReview(input: ReviewInput): Promise<Review> {
    if (clientStorageMode === "browser-local") {
      const review = createReviewInBrowser(input);
      refreshBrowserState();
      return review;
    }

    const payload = await fetchJson<{ data: Review }>("/api/reviews", input);
    return payload.data;
  }

  async function refineIntake(input: IntakeRefineInput): Promise<IntakeRefinement> {
    const payload = await fetchJson<{ data: IntakeRefinement }>("/api/ai/intake-refine", {
      ...input,
      locale: input.locale ?? state.uiPreferences.locale,
    });
    return payload.data;
  }

  async function generateMap(input: GenerateMapInput): Promise<MapDraft> {
    const payload = await fetchJson<{ data: MapDraft }>("/api/ai/generate-map", {
      ...input,
      locale: input.locale ?? state.uiPreferences.locale,
    });
    return payload.data;
  }

  async function planToday(input: PlanTodayInput): Promise<TodayPlan> {
    const payload = await fetchJson<{ data: TodayPlan }>("/api/ai/plan-today", {
      ...input,
      goalSnapshot: input.goalSnapshot ?? state.currentGoal,
      questSnapshots: input.questSnapshots ?? state.currentQuests,
      blockerSnapshots: input.blockerSnapshots ?? state.currentBlockers,
      latestReviewSnapshot: input.latestReviewSnapshot ?? state.currentReviews[0] ?? null,
      locale: input.locale ?? state.uiPreferences.locale,
    });

    if (clientStorageMode === "browser-local") {
      const goalId = input.goalSnapshot?.id ?? state.currentGoal?.id;
      if (goalId) {
        recordTodayPlanInBrowser(goalId, payload.data);
        refreshBrowserState();
      }
    }

    return payload.data;
  }

  async function generateReviewFocusReasons(input: ReviewFocusReasonsInput): Promise<ReviewFocusCandidateReason[]> {
    const locale = input.locale ?? state.uiPreferences.locale;
    const fallback = buildHeuristicReviewFocusReasons(input.candidates, locale);

    if (clientStorageMode === "browser-local") {
      return fallback;
    }

    try {
      const payload = await fetchJson<{ data: ReviewFocusCandidateReason[] }>("/api/ai/review-focus-reasons", {
        ...input,
        currentFocusGoalId: input.currentFocusGoalId ?? state.focusGoal?.id ?? null,
        locale,
      });
      return payload.data.length ? payload.data : fallback;
    } catch {
      return fallback;
    }
  }

  const value: QuestAgentContextValue = {
    state,
    clientStorageMode,
    backendMode: clientStorageMode === "browser-local" ? "browser-local" : initialBackendMode,
    aiMode,
    aiEnabled: aiMode === "ai",
    saveGoal,
    replaceMap,
    updateQuestStatus,
    createBlocker,
    createReview,
    updatePortfolioSettings,
    updateUiPreferences,
    selectFocusGoal,
    parkGoal,
    resumeGoal,
    buildImproveCheck,
    startWorkSession,
    finishWorkSession,
    saveReturnInterview,
    saveReturnRun,
    refineIntake,
    generateMap,
    planToday,
    rerouteFromBlocker,
    generateReviewFocusReasons,
  };

  return <QuestAgentContext.Provider value={value}>{children}</QuestAgentContext.Provider>;
}

export function useQuestAgent() {
  const context = useContext(QuestAgentContext);
  if (!context) {
    throw new Error("useQuestAgent must be used inside QuestAgentProvider.");
  }

  return context;
}

