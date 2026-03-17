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
  readBrowserAppState,
  recordTodayPlanInBrowser,
  replaceMapInBrowser,
  saveGoalInBrowser,
  updateQuestStatusInBrowser,
} from "@/lib/quest-agent/browser-store";
import { buildHeuristicBlockerReroute } from "@/lib/quest-agent/derive";
import type {
  AppState,
  BackendModeLabel,
  Blocker,
  BlockerInput,
  BlockerReroute,
  ClientStorageHint,
  ClientStorageMode,
  GenerateMapInput,
  Goal,
  GoalInput,
  IntakeRefineInput,
  IntakeRefinement,
  MapDraft,
  MapInput,
  PlanTodayInput,
  Quest,
  QuestStatus,
  Review,
  ReviewInput,
  RerouteInput,
  TodayPlan,
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
  refineIntake: (input: IntakeRefineInput) => Promise<IntakeRefinement>;
  generateMap: (input: GenerateMapInput) => Promise<MapDraft>;
  planToday: (input: PlanTodayInput) => Promise<TodayPlan>;
  rerouteFromBlocker: (input: RerouteInput) => Promise<BlockerReroute>;
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

  async function rerouteFromBlocker(input: RerouteInput): Promise<BlockerReroute> {
    if (clientStorageMode === "browser-local") {
      try {
        const payload = await fetchJson<{ data: BlockerReroute }>("/api/ai/reroute-from-blocker", {
          ...input,
          goalSnapshot: input.goalSnapshot ?? state.currentGoal,
        });
        return payload.data;
      } catch {
        const fallbackGoal = input.goalSnapshot ?? state.currentGoal;
        if (!fallbackGoal) {
          throw new Error("Goal not found.");
        }
        return buildHeuristicBlockerReroute(fallbackGoal, {
          title: input.title,
          description: input.description,
          blockerType: input.blockerType,
        });
      }
    }

    const payload = await fetchJson<{ data: BlockerReroute }>("/api/ai/reroute-from-blocker", input);
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
    const payload = await fetchJson<{ data: IntakeRefinement }>("/api/ai/intake-refine", input);
    return payload.data;
  }

  async function generateMap(input: GenerateMapInput): Promise<MapDraft> {
    const payload = await fetchJson<{ data: MapDraft }>("/api/ai/generate-map", input);
    return payload.data;
  }

  async function planToday(input: PlanTodayInput): Promise<TodayPlan> {
    const payload = await fetchJson<{ data: TodayPlan }>("/api/ai/plan-today", {
      ...input,
      goalSnapshot: input.goalSnapshot ?? state.currentGoal,
      questSnapshots: input.questSnapshots ?? state.currentQuests,
      blockerSnapshots: input.blockerSnapshots ?? state.currentBlockers,
      latestReviewSnapshot: input.latestReviewSnapshot ?? state.currentReviews[0] ?? null,
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
    refineIntake,
    generateMap,
    planToday,
    rerouteFromBlocker,
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