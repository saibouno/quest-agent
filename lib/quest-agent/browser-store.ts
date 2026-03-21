import {
  emptyPersistedState,
  enrichState,
} from "@/lib/quest-agent/derive";
import {
  createBlockerInState,
  createReviewInState,
  finishWorkSessionInState,
  parkGoalInState,
  recordBuildImproveDecisionInState,
  recordReturnInterviewInState,
  recordReturnRunInState,
  recordTodayPlanInState,
  replaceMapInState,
  resumeGoalInState,
  saveGoalInState,
  selectFocusGoalInState,
  startWorkSessionInState,
  updatePortfolioSettingsInState,
  updateQuestStatusInState,
  updateUiPreferencesInState,
} from "@/lib/quest-agent/transitions";
import type {
  AppState,
  Blocker,
  BlockerSaveInput,
  BottleneckInterview,
  BuildImproveCheckInput,
  BuildImproveDecision,
  FocusGoalInput,
  Goal,
  GoalInput,
  MapInput,
  ParkGoalInput,
  PersistedState,
  PortfolioSettings,
  PortfolioSettingsInput,
  UiPreferences,
  UiPreferencesInput,
  Quest,
  QuestStatus,
  ResumeGoalInput,
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

const browserStateKey = "quest-agent-browser-preview-state";

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
      uiPreferences: {
        ...emptyPersistedState().uiPreferences,
        ...(parsed.uiPreferences ?? {}),
      },
      portfolioSettings: {
        ...emptyPersistedState().portfolioSettings,
        ...(parsed.portfolioSettings ?? {}),
      },
      resumeQueueItems: parsed.resumeQueueItems ?? [],
      workSessions: parsed.workSessions ?? [],
      metaWorkFlags: parsed.metaWorkFlags ?? [],
      bottleneckInterviews: parsed.bottleneckInterviews ?? [],
      buildImproveDecisions: parsed.buildImproveDecisions ?? [],
      returnRuns: parsed.returnRuns ?? [],
      leadMetricsDaily: parsed.leadMetricsDaily ?? [],
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
  const result = saveGoalInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.goal;
}

export function replaceMapInBrowser(input: MapInput): void {
  writeBrowserState(replaceMapInState(readBrowserState(), input));
}

export function updateQuestStatusInBrowser(questId: string, status: QuestStatus): Quest {
  const result = updateQuestStatusInState(readBrowserState(), questId, status);
  writeBrowserState(result.state);
  return result.quest;
}

export function createBlockerInBrowser(input: BlockerSaveInput): Blocker {
  const result = createBlockerInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.blocker;
}

export function createReviewInBrowser(input: ReviewInput): Review {
  const result = createReviewInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.review;
}

export function recordTodayPlanInBrowser(goalId: string, plan: TodayPlan): void {
  writeBrowserState(recordTodayPlanInState(readBrowserState(), goalId, plan));
}

export function updatePortfolioSettingsInBrowser(input: PortfolioSettingsInput): PortfolioSettings {
  const result = updatePortfolioSettingsInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.portfolioSettings;
}

export function updateUiPreferencesInBrowser(input: UiPreferencesInput): UiPreferences {
  const result = updateUiPreferencesInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.uiPreferences;
}

export function selectFocusGoalInBrowser(input: FocusGoalInput): Goal {
  const result = selectFocusGoalInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.goal;
}

export function parkGoalInBrowser(input: ParkGoalInput): Goal {
  const result = parkGoalInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.goal;
}

export function resumeGoalInBrowser(input: ResumeGoalInput): Goal {
  const result = resumeGoalInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.goal;
}

export function recordBuildImproveDecisionInBrowser(input: BuildImproveCheckInput): BuildImproveDecision {
  const result = recordBuildImproveDecisionInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.decision;
}

export function startWorkSessionInBrowser(input: WorkSessionStartInput): WorkSession {
  const result = startWorkSessionInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.session;
}

export function finishWorkSessionInBrowser(input: WorkSessionFinishInput): WorkSession {
  const result = finishWorkSessionInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.session;
}

export function recordReturnInterviewInBrowser(input: ReturnInterviewInput): BottleneckInterview {
  const result = recordReturnInterviewInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.interview;
}

export function recordReturnRunInBrowser(input: ReturnRunInput): ReturnRun {
  const result = recordReturnRunInState(readBrowserState(), input);
  writeBrowserState(result.state);
  return result.returnRun;
}
