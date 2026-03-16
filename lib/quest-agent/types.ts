export const goalStatuses = ["draft", "active", "paused", "completed", "abandoned"] as const;
export type GoalStatus = (typeof goalStatuses)[number];

export const milestoneStatuses = ["planned", "active", "completed"] as const;
export type MilestoneStatus = (typeof milestoneStatuses)[number];

export const questStatuses = ["planned", "ready", "in_progress", "blocked", "completed"] as const;
export type QuestStatus = (typeof questStatuses)[number];

export const priorityLevels = ["high", "medium", "low"] as const;
export type PriorityLevel = (typeof priorityLevels)[number];

export const questTypes = ["main", "side"] as const;
export type QuestType = (typeof questTypes)[number];

export const blockerTypes = ["clarity", "time", "decision", "dependency", "energy", "unknown"] as const;
export type BlockerType = (typeof blockerTypes)[number];

export const blockerStatuses = ["open", "resolved"] as const;
export type BlockerStatus = (typeof blockerStatuses)[number];

export const severityLevels = ["high", "medium", "low"] as const;
export type SeverityLevel = (typeof severityLevels)[number];

export type EntityType = "goal" | "milestone" | "quest" | "blocker" | "review" | "decision" | "artifact" | "system";

export interface Goal {
  id: string;
  title: string;
  description: string;
  why: string;
  deadline: string | null;
  successCriteria: string[];
  currentState: string;
  constraints: string[];
  concerns: string;
  todayCapacity: string;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  goalId: string;
  title: string;
  description: string;
  sequence: number;
  targetDate: string | null;
  status: MilestoneStatus;
  createdAt: string;
}

export interface Quest {
  id: string;
  goalId: string;
  milestoneId: string | null;
  title: string;
  description: string;
  priority: PriorityLevel;
  status: QuestStatus;
  dueDate: string | null;
  estimatedMinutes: number | null;
  questType: QuestType;
  createdAt: string;
  updatedAt: string;
}

export interface Blocker {
  id: string;
  goalId: string;
  relatedQuestId: string | null;
  title: string;
  description: string;
  blockerType: BlockerType;
  severity: SeverityLevel;
  status: BlockerStatus;
  suggestedNextStep: string;
  detectedAt: string;
}

export interface Review {
  id: string;
  goalId: string;
  periodStart: string;
  periodEnd: string;
  summary: string;
  learnings: string;
  rerouteNote: string;
  nextFocus: string;
  createdAt: string;
}

export interface Decision {
  id: string;
  goalId: string;
  title: string;
  description: string;
  rationale: string;
  decidedAt: string;
}

export interface Artifact {
  id: string;
  goalId: string;
  title: string;
  artifactType: "note" | "link" | "file" | "output";
  urlOrRef: string;
  note: string;
  createdAt: string;
}

export interface QuestEvent {
  id: string;
  goalId: string;
  entityType: EntityType;
  entityId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PersistedState {
  goals: Goal[];
  milestones: Milestone[];
  quests: Quest[];
  blockers: Blocker[];
  reviews: Review[];
  decisions: Decision[];
  artifacts: Artifact[];
  events: QuestEvent[];
}

export interface MapDraftQuest {
  title: string;
  description: string;
  priority: PriorityLevel;
  dueDate: string | null;
  estimatedMinutes: number | null;
  questType: QuestType;
}

export interface MapDraftMilestone {
  tempId: string;
  title: string;
  description: string;
  targetDate: string | null;
  quests: MapDraftQuest[];
}

export interface MapDraft {
  routeSummary: string;
  milestones: MapDraftMilestone[];
  mode: "ai" | "heuristic";
}

export interface IntakeRefinement {
  goalTitle: string;
  goalSummary: string;
  successCriteria: string[];
  constraintsToWatch: string[];
  openQuestions: string[];
  firstRouteNote: string;
  mode: "ai" | "heuristic";
}

export interface TodayQuestSuggestion {
  questId: string | null;
  title: string;
  reason: string;
  focusMinutes: number;
  successHint: string;
  status: QuestStatus | "suggested";
}

export interface TodayPlan {
  theme: string;
  quests: TodayQuestSuggestion[];
  notes: string[];
  mode: "ai" | "heuristic";
}

export interface BlockerReroute {
  blockerLabel: string;
  diagnosis: string;
  nextStep: string;
  alternateRoute: string;
  reframing: string;
  mode: "ai" | "heuristic";
}

export interface DashboardStats {
  activeQuestCount: number;
  completedThisWeek: number;
  openBlockerCount: number;
  milestoneCount: number;
}

export interface AppState extends PersistedState {
  currentGoal: Goal | null;
  currentMilestones: Milestone[];
  currentQuests: Quest[];
  currentBlockers: Blocker[];
  currentReviews: Review[];
  todaySuggestions: TodayQuestSuggestion[];
  stats: DashboardStats;
  recentEvents: QuestEvent[];
}
