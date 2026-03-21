import "server-only";

import { createClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";
import { promises as fs } from "node:fs";
import path from "node:path";

import { defaultUiPreferences, defaultUserProfile, emptyPersistedState, enrichState } from "@/lib/quest-agent/derive";
import { hasSupabaseConfig, shouldUseBrowserLocalPreview } from "@/lib/quest-agent/server/runtime";
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
  Artifact,
  Blocker,
  BlockerSaveInput,
  BottleneckInterview,
  BuildImproveCheckInput,
  BuildImproveDecision,
  Decision,
  FocusGoalInput,
  Goal,
  GoalInput,
  LeadMetricsDaily,
  MapInput,
  MetaWorkFlag,
  Milestone,
  ParkGoalInput,
  PersistedState,
  PortfolioSettings,
  PortfolioSettingsInput,
  UiPreferences,
  UiPreferencesInput,
  Quest,
  QuestEvent,
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

const fallbackPath = path.join(process.cwd(), "data", "quest-agent-fallback.json");

type DbRow = Record<string, unknown>;

type TableConfig = {
  name: string;
  previousIds: string[];
  nextIds: string[];
  serializedRows: DbRow[];
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toGoal(row: DbRow): Goal {
  return {
    id: asString(row.id),
    title: asString(row.title),
    description: asString(row.description),
    why: asString(row.why),
    deadline: asNullableString(row.deadline),
    successCriteria: asStringArray(row.success_criteria),
    currentState: asString(row.current_state),
    constraints: asStringArray(row.constraints),
    concerns: asString(row.concerns),
    todayCapacity: asString(row.today_capacity),
    status: (asString(row.status) as Goal["status"]) || "draft",
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function toMilestone(row: DbRow): Milestone {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    title: asString(row.title),
    description: asString(row.description),
    sequence: asNumber(row.sequence),
    targetDate: asNullableString(row.target_date),
    status: (asString(row.status) as Milestone["status"]) || "planned",
    createdAt: asString(row.created_at),
  };
}

function toQuest(row: DbRow): Quest {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    milestoneId: asNullableString(row.milestone_id),
    title: asString(row.title),
    description: asString(row.description),
    priority: (asString(row.priority) as Quest["priority"]) || "medium",
    status: (asString(row.status) as Quest["status"]) || "planned",
    dueDate: asNullableString(row.due_date),
    estimatedMinutes: asNullableNumber(row.estimated_minutes),
    questType: (asString(row.quest_type) as Quest["questType"]) || "main",
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function toBlocker(row: DbRow): Blocker {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    relatedQuestId: asNullableString(row.related_quest_id),
    title: asString(row.title),
    description: asString(row.description),
    blockerType: (asString(row.blocker_type) as Blocker["blockerType"]) || "unknown",
    severity: (asString(row.severity) as Blocker["severity"]) || "medium",
    status: (asString(row.status) as Blocker["status"]) || "open",
    suggestedNextStep: asString(row.suggested_next_step),
    detectedAt: asString(row.detected_at),
  };
}

function toReview(row: DbRow): Review {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    periodStart: asString(row.period_start),
    periodEnd: asString(row.period_end),
    summary: asString(row.summary),
    learnings: asString(row.learnings),
    rerouteNote: asString(row.reroute_note),
    nextFocus: asString(row.next_focus),
    createdAt: asString(row.created_at),
  };
}

function toDecision(row: DbRow): Decision {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    title: asString(row.title),
    description: asString(row.description),
    rationale: asString(row.rationale),
    decidedAt: asString(row.decided_at),
  };
}

function toArtifact(row: DbRow): Artifact {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    title: asString(row.title),
    artifactType: (asString(row.artifact_type) as Artifact["artifactType"]) || "note",
    urlOrRef: asString(row.url_or_ref),
    note: asString(row.note),
    createdAt: asString(row.created_at),
  };
}

function toEvent(row: DbRow): QuestEvent {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    entityType: (asString(row.entity_type) as QuestEvent["entityType"]) || "system",
    entityId: asString(row.entity_id),
    type: asString(row.type),
    payload: asObject(row.payload),
    createdAt: asString(row.created_at),
  };
}
function toPortfolioSettings(row: DbRow | null): PortfolioSettings {
  if (!row) {
    return emptyPersistedState().portfolioSettings;
  }

  return {
    wipLimit: asNumber(row.wip_limit) || 1,
    focusGoalId: asNullableString(row.focus_goal_id),
    updatedAt: asString(row.updated_at),
  };
}

function toUiPreferences(row: DbRow | null): UiPreferences {
  if (!row) {
    return defaultUiPreferences();
  }

  return {
    locale: (asString(row.locale) as UiPreferences["locale"]) || "ja",
  };
}

function toResumeQueueItem(row: DbRow): ResumeQueueItem {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    stopMode: (asString(row.stop_mode) as ResumeQueueItem["stopMode"]) || "hold",
    parkedAt: asString(row.parked_at),
    reason: asString(row.reason),
    parkingNote: asString(row.parking_note),
    nextRestartStep: asString(row.next_restart_step),
    resumeTriggerType: (asString(row.resume_trigger_type) as ResumeQueueItem["resumeTriggerType"]) || "manual",
    resumeTriggerText: asString(row.resume_trigger_text),
    status: (asString(row.status) as ResumeQueueItem["status"]) || "waiting",
  };
}

function toBuildImproveDecision(row: DbRow): BuildImproveDecision {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    questId: asNullableString(row.quest_id),
    category: (asString(row.category) as BuildImproveDecision["category"]) || "main",
    mainConnection: (asString(row.main_connection) as BuildImproveDecision["mainConnection"]) || "direct",
    artifactCommitment: asString(row.artifact_commitment),
    timeboxMinutes: asNumber(row.timebox_minutes),
    doneWhen: asString(row.done_when),
    mode: (asString(row.mode) as BuildImproveDecision["mode"]) || "build",
    rationale: asString(row.rationale),
    createdAt: asString(row.created_at),
  };
}

function toWorkSession(row: DbRow): WorkSession {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    questId: asNullableString(row.quest_id),
    gateDecisionId: asNullableString(row.gate_decision_id),
    category: (asString(row.category) as WorkSession["category"]) || "main",
    plannedMinutes: asNumber(row.planned_minutes),
    startedAt: asString(row.started_at),
    endedAt: asNullableString(row.ended_at),
    artifactNote: asString(row.artifact_note),
  };
}

function toMetaWorkFlag(row: DbRow): MetaWorkFlag {
  return {
    id: asString(row.id),
    goalId: asNullableString(row.goal_id),
    dayKey: asString(row.day_key),
    flagType: (asString(row.flag_type) as MetaWorkFlag["flagType"]) || "main_work_absent",
    message: asString(row.message),
    createdAt: asString(row.created_at),
  };
}

function toBottleneckInterview(row: DbRow): BottleneckInterview {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    mainQuest: asString(row.main_quest),
    primaryBottleneck: (asString(row.primary_bottleneck) as BottleneckInterview["primaryBottleneck"]) || "unclear",
    avoidanceHypothesis: asString(row.avoidance_hypothesis),
    smallestWin: asString(row.smallest_win),
    createdAt: asString(row.created_at),
  };
}

function toReturnRun(row: DbRow): ReturnRun {
  return {
    id: asString(row.id),
    goalId: asString(row.goal_id),
    questId: asNullableString(row.quest_id),
    interviewId: asNullableString(row.interview_id),
    mirrorMessage: asString(row.mirror_message),
    diagnosisType: (asString(row.diagnosis_type) as ReturnRun["diagnosisType"]) || "unclear",
    woopPlan: asString(row.woop_plan),
    ifThenPlan: asString(row.if_then_plan),
    next15mAction: asString(row.next_15m_action),
    decision: (asString(row.decision) as ReturnRun["decision"]) || "fight",
    decisionNote: asString(row.decision_note),
    reviewDate: asNullableString(row.review_date),
    createdAt: asString(row.created_at),
  };
}

function toLeadMetricsDaily(row: DbRow): LeadMetricsDaily {
  return {
    dayKey: asString(row.day_key),
    mainWorkRatio: asNumber(row.main_work_ratio),
    metaWorkRatio: asNumber(row.meta_work_ratio),
    startDelayMinutes: asNullableNumber(row.start_delay_minutes),
    resumeDelayMinutes: asNullableNumber(row.resume_delay_minutes),
    switchDensity: asNumber(row.switch_density),
    ifThenCoverage: asNumber(row.if_then_coverage),
    monitoringDone: asBoolean(row.monitoring_done),
  };
}

function goalRow(goal: Goal): DbRow {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    why: goal.why,
    deadline: goal.deadline,
    success_criteria: goal.successCriteria,
    current_state: goal.currentState,
    constraints: goal.constraints,
    concerns: goal.concerns,
    today_capacity: goal.todayCapacity,
    status: goal.status,
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
  };
}

function milestoneRow(milestone: Milestone): DbRow {
  return {
    id: milestone.id,
    goal_id: milestone.goalId,
    title: milestone.title,
    description: milestone.description,
    sequence: milestone.sequence,
    target_date: milestone.targetDate,
    status: milestone.status,
    created_at: milestone.createdAt,
  };
}

function questRow(quest: Quest): DbRow {
  return {
    id: quest.id,
    goal_id: quest.goalId,
    milestone_id: quest.milestoneId,
    title: quest.title,
    description: quest.description,
    priority: quest.priority,
    status: quest.status,
    due_date: quest.dueDate,
    estimated_minutes: quest.estimatedMinutes,
    quest_type: quest.questType,
    created_at: quest.createdAt,
    updated_at: quest.updatedAt,
  };
}

function blockerRow(blocker: Blocker): DbRow {
  return {
    id: blocker.id,
    goal_id: blocker.goalId,
    related_quest_id: blocker.relatedQuestId,
    title: blocker.title,
    description: blocker.description,
    blocker_type: blocker.blockerType,
    severity: blocker.severity,
    status: blocker.status,
    suggested_next_step: blocker.suggestedNextStep,
    detected_at: blocker.detectedAt,
  };
}

function reviewRow(review: Review): DbRow {
  return {
    id: review.id,
    goal_id: review.goalId,
    period_start: review.periodStart,
    period_end: review.periodEnd,
    summary: review.summary,
    learnings: review.learnings,
    reroute_note: review.rerouteNote,
    next_focus: review.nextFocus,
    created_at: review.createdAt,
  };
}

function decisionRow(decision: Decision): DbRow {
  return {
    id: decision.id,
    goal_id: decision.goalId,
    title: decision.title,
    description: decision.description,
    rationale: decision.rationale,
    decided_at: decision.decidedAt,
  };
}

function artifactRow(artifact: Artifact): DbRow {
  return {
    id: artifact.id,
    goal_id: artifact.goalId,
    title: artifact.title,
    artifact_type: artifact.artifactType,
    url_or_ref: artifact.urlOrRef,
    note: artifact.note,
    created_at: artifact.createdAt,
  };
}

function eventRow(event: QuestEvent): DbRow {
  return {
    id: event.id,
    goal_id: event.goalId,
    entity_type: event.entityType,
    entity_id: event.entityId,
    type: event.type,
    payload: event.payload,
    created_at: event.createdAt,
  };
}

function portfolioSettingsRow(portfolioSettings: PortfolioSettings): DbRow {
  return {
    id: "default",
    wip_limit: portfolioSettings.wipLimit,
    focus_goal_id: portfolioSettings.focusGoalId,
    updated_at: portfolioSettings.updatedAt,
  };
}

function uiPreferencesRow(uiPreferences: UiPreferences): DbRow {
  return {
    id: "default",
    locale: uiPreferences.locale,
  };
}

function resumeQueueItemRow(item: ResumeQueueItem): DbRow {
  return {
    id: item.id,
    goal_id: item.goalId,
    stop_mode: item.stopMode,
    parked_at: item.parkedAt,
    reason: item.reason,
    parking_note: item.parkingNote,
    next_restart_step: item.nextRestartStep,
    resume_trigger_type: item.resumeTriggerType,
    resume_trigger_text: item.resumeTriggerText,
    status: item.status,
  };
}
function buildImproveDecisionRow(decision: BuildImproveDecision): DbRow {
  return {
    id: decision.id,
    goal_id: decision.goalId,
    quest_id: decision.questId,
    category: decision.category,
    main_connection: decision.mainConnection,
    artifact_commitment: decision.artifactCommitment,
    timebox_minutes: decision.timeboxMinutes,
    done_when: decision.doneWhen,
    mode: decision.mode,
    rationale: decision.rationale,
    created_at: decision.createdAt,
  };
}

function workSessionRow(session: WorkSession): DbRow {
  return {
    id: session.id,
    goal_id: session.goalId,
    quest_id: session.questId,
    gate_decision_id: session.gateDecisionId,
    category: session.category,
    planned_minutes: session.plannedMinutes,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    artifact_note: session.artifactNote,
  };
}

function metaWorkFlagRow(flag: MetaWorkFlag): DbRow {
  return {
    id: flag.id,
    goal_id: flag.goalId,
    day_key: flag.dayKey,
    flag_type: flag.flagType,
    message: flag.message,
    created_at: flag.createdAt,
  };
}

function bottleneckInterviewRow(interview: BottleneckInterview): DbRow {
  return {
    id: interview.id,
    goal_id: interview.goalId,
    main_quest: interview.mainQuest,
    primary_bottleneck: interview.primaryBottleneck,
    avoidance_hypothesis: interview.avoidanceHypothesis,
    smallest_win: interview.smallestWin,
    created_at: interview.createdAt,
  };
}

function returnRunRow(returnRun: ReturnRun): DbRow {
  return {
    id: returnRun.id,
    goal_id: returnRun.goalId,
    quest_id: returnRun.questId,
    interview_id: returnRun.interviewId,
    mirror_message: returnRun.mirrorMessage,
    diagnosis_type: returnRun.diagnosisType,
    woop_plan: returnRun.woopPlan,
    if_then_plan: returnRun.ifThenPlan,
    next_15m_action: returnRun.next15mAction,
    decision: returnRun.decision,
    decision_note: returnRun.decisionNote,
    review_date: returnRun.reviewDate,
    created_at: returnRun.createdAt,
  };
}

function leadMetricsDailyRow(metrics: LeadMetricsDaily): DbRow {
  return {
    day_key: metrics.dayKey,
    main_work_ratio: metrics.mainWorkRatio,
    meta_work_ratio: metrics.metaWorkRatio,
    start_delay_minutes: metrics.startDelayMinutes,
    resume_delay_minutes: metrics.resumeDelayMinutes,
    switch_density: metrics.switchDensity,
    if_then_coverage: metrics.ifThenCoverage,
    monitoring_done: metrics.monitoringDone,
  };
}

function getSupabaseClient() {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase is not configured.");
  }

  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function ensureFallbackFile(): Promise<void> {
  await fs.mkdir(path.dirname(fallbackPath), { recursive: true });
  try {
    await fs.access(fallbackPath);
  } catch {
    await fs.writeFile(fallbackPath, JSON.stringify(emptyPersistedState(), null, 2), "utf8");
  }
}

async function readFallbackState(): Promise<PersistedState> {
  await ensureFallbackFile();
  const content = await fs.readFile(fallbackPath, "utf8");
  const parsed = JSON.parse(content) as Partial<PersistedState>;
  return {
    ...emptyPersistedState(),
    ...parsed,
    userProfile: {
      ...defaultUserProfile(),
      ...(parsed.userProfile ?? {}),
    },
    uiPreferences: {
      ...defaultUiPreferences(),
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
}

async function writeFallbackState(state: PersistedState): Promise<void> {
  await ensureFallbackFile();
  await fs.writeFile(fallbackPath, JSON.stringify(state, null, 2), "utf8");
}

async function readSupabaseState(): Promise<PersistedState> {
  const supabase = getSupabaseClient();
  const [
    goalsRes,
    milestonesRes,
    questsRes,
    blockersRes,
    reviewsRes,
    decisionsRes,
    artifactsRes,
    eventsRes,
    portfolioSettingsRes,
    uiPreferencesRes,
    resumeQueueRes,
    buildImproveRes,
    workSessionsRes,
    metaWorkFlagsRes,
    bottleneckInterviewsRes,
    returnRunsRes,
    leadMetricsRes,
  ] = await Promise.all([
    supabase.from("goals").select("*").order("updated_at", { ascending: false }),
    supabase.from("milestones").select("*").order("sequence", { ascending: true }),
    supabase.from("quests").select("*").order("created_at", { ascending: true }),
    supabase.from("blockers").select("*").order("detected_at", { ascending: false }),
    supabase.from("reviews").select("*").order("created_at", { ascending: false }),
    supabase.from("decisions").select("*").order("decided_at", { ascending: false }),
    supabase.from("artifacts").select("*").order("created_at", { ascending: false }),
    supabase.from("events").select("*").order("created_at", { ascending: false }),
    supabase.from("portfolio_settings").select("*").limit(1).maybeSingle(),
    supabase.from("ui_preferences").select("*").limit(1).maybeSingle(),
    supabase.from("resume_queue_items").select("*").order("parked_at", { ascending: false }),
    supabase.from("build_improve_decisions").select("*").order("created_at", { ascending: false }),
    supabase.from("work_sessions").select("*").order("started_at", { ascending: true }),
    supabase.from("meta_work_flags").select("*").order("day_key", { ascending: false }),
    supabase.from("bottleneck_interviews").select("*").order("created_at", { ascending: false }),
    supabase.from("return_runs").select("*").order("created_at", { ascending: false }),
    supabase.from("lead_metrics_daily").select("*").order("day_key", { ascending: false }),
  ]);

  const responses = [
    goalsRes,
    milestonesRes,
    questsRes,
    blockersRes,
    reviewsRes,
    decisionsRes,
    artifactsRes,
    eventsRes,
    portfolioSettingsRes,
    uiPreferencesRes,
    resumeQueueRes,
    buildImproveRes,
    workSessionsRes,
    metaWorkFlagsRes,
    bottleneckInterviewsRes,
    returnRunsRes,
    leadMetricsRes,
  ];
  for (const response of responses) {
    if (response.error) {
      throw new Error(response.error.message);
    }
  }

  return {
    goals: (goalsRes.data ?? []).map(toGoal),
    milestones: (milestonesRes.data ?? []).map(toMilestone),
    quests: (questsRes.data ?? []).map(toQuest),
    blockers: (blockersRes.data ?? []).map(toBlocker),
    reviews: (reviewsRes.data ?? []).map(toReview),
    decisions: (decisionsRes.data ?? []).map(toDecision),
    artifacts: (artifactsRes.data ?? []).map(toArtifact),
    events: (eventsRes.data ?? []).map(toEvent),
    userProfile: defaultUserProfile(),
    uiPreferences: toUiPreferences(uiPreferencesRes.data as DbRow | null),
    portfolioSettings: toPortfolioSettings(portfolioSettingsRes.data as DbRow | null),
    resumeQueueItems: (resumeQueueRes.data ?? []).map(toResumeQueueItem),
    workSessions: (workSessionsRes.data ?? []).map(toWorkSession),
    metaWorkFlags: (metaWorkFlagsRes.data ?? []).map(toMetaWorkFlag),
    bottleneckInterviews: (bottleneckInterviewsRes.data ?? []).map(toBottleneckInterview),
    buildImproveDecisions: (buildImproveRes.data ?? []).map(toBuildImproveDecision),
    returnRuns: (returnRunsRes.data ?? []).map(toReturnRun),
    leadMetricsDaily: (leadMetricsRes.data ?? []).map(toLeadMetricsDaily),
  };
}

async function readStoredState(): Promise<PersistedState> {
  if (hasSupabaseConfig()) {
    return readSupabaseState();
  }
  return readFallbackState();
}
async function deleteMissingRows(config: TableConfig): Promise<void> {
  const idsToDelete = config.previousIds.filter((id) => !config.nextIds.includes(id));
  if (!idsToDelete.length) {
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from(config.name).delete().in("id", idsToDelete);
  if (error) {
    throw new Error(error.message);
  }
}

async function upsertRows(config: TableConfig, conflictColumn = "id"): Promise<void> {
  if (!config.serializedRows.length) {
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from(config.name).upsert(config.serializedRows, { onConflict: conflictColumn });
  if (error) {
    throw new Error(error.message);
  }
}

async function writeSupabaseState(previousState: PersistedState, nextState: PersistedState): Promise<void> {
  const deleteOrder: TableConfig[] = [
    { name: "work_sessions", previousIds: previousState.workSessions.map((item) => item.id), nextIds: nextState.workSessions.map((item) => item.id), serializedRows: nextState.workSessions.map(workSessionRow) },
    { name: "return_runs", previousIds: previousState.returnRuns.map((item) => item.id), nextIds: nextState.returnRuns.map((item) => item.id), serializedRows: nextState.returnRuns.map(returnRunRow) },
    { name: "bottleneck_interviews", previousIds: previousState.bottleneckInterviews.map((item) => item.id), nextIds: nextState.bottleneckInterviews.map((item) => item.id), serializedRows: nextState.bottleneckInterviews.map(bottleneckInterviewRow) },
    { name: "build_improve_decisions", previousIds: previousState.buildImproveDecisions.map((item) => item.id), nextIds: nextState.buildImproveDecisions.map((item) => item.id), serializedRows: nextState.buildImproveDecisions.map(buildImproveDecisionRow) },
    { name: "resume_queue_items", previousIds: previousState.resumeQueueItems.map((item) => item.id), nextIds: nextState.resumeQueueItems.map((item) => item.id), serializedRows: nextState.resumeQueueItems.map(resumeQueueItemRow) },
    { name: "events", previousIds: previousState.events.map((event) => event.id), nextIds: nextState.events.map((event) => event.id), serializedRows: nextState.events.map(eventRow) },
    { name: "artifacts", previousIds: previousState.artifacts.map((artifact) => artifact.id), nextIds: nextState.artifacts.map((artifact) => artifact.id), serializedRows: nextState.artifacts.map(artifactRow) },
    { name: "decisions", previousIds: previousState.decisions.map((decision) => decision.id), nextIds: nextState.decisions.map((decision) => decision.id), serializedRows: nextState.decisions.map(decisionRow) },
    { name: "reviews", previousIds: previousState.reviews.map((review) => review.id), nextIds: nextState.reviews.map((review) => review.id), serializedRows: nextState.reviews.map(reviewRow) },
    { name: "blockers", previousIds: previousState.blockers.map((blocker) => blocker.id), nextIds: nextState.blockers.map((blocker) => blocker.id), serializedRows: nextState.blockers.map(blockerRow) },
    { name: "quests", previousIds: previousState.quests.map((quest) => quest.id), nextIds: nextState.quests.map((quest) => quest.id), serializedRows: nextState.quests.map(questRow) },
    { name: "milestones", previousIds: previousState.milestones.map((milestone) => milestone.id), nextIds: nextState.milestones.map((milestone) => milestone.id), serializedRows: nextState.milestones.map(milestoneRow) },
    { name: "goals", previousIds: previousState.goals.map((goal) => goal.id), nextIds: nextState.goals.map((goal) => goal.id), serializedRows: nextState.goals.map(goalRow) },
    { name: "meta_work_flags", previousIds: previousState.metaWorkFlags.map((flag) => flag.id), nextIds: nextState.metaWorkFlags.map((flag) => flag.id), serializedRows: nextState.metaWorkFlags.map(metaWorkFlagRow) },
    { name: "lead_metrics_daily", previousIds: previousState.leadMetricsDaily.map((item) => item.dayKey), nextIds: nextState.leadMetricsDaily.map((item) => item.dayKey), serializedRows: nextState.leadMetricsDaily.map(leadMetricsDailyRow) },
    { name: "portfolio_settings", previousIds: ["default"], nextIds: ["default"], serializedRows: [portfolioSettingsRow(nextState.portfolioSettings)] },
    { name: "ui_preferences", previousIds: ["default"], nextIds: ["default"], serializedRows: [uiPreferencesRow(nextState.uiPreferences)] },
  ];

  for (const table of deleteOrder) {
    if (table.name === "lead_metrics_daily") {
      const idsToDelete = table.previousIds.filter((id) => !table.nextIds.includes(id));
      if (!idsToDelete.length) {
        continue;
      }
      const supabase = getSupabaseClient();
      const { error } = await supabase.from(table.name).delete().in("day_key", idsToDelete);
      if (error) {
        throw new Error(error.message);
      }
      continue;
    }
    await deleteMissingRows(table);
  }

  const upsertOrder: Array<TableConfig & { conflictColumn?: string }> = [
    { name: "goals", previousIds: previousState.goals.map((goal) => goal.id), nextIds: nextState.goals.map((goal) => goal.id), serializedRows: nextState.goals.map(goalRow) },
    { name: "milestones", previousIds: previousState.milestones.map((milestone) => milestone.id), nextIds: nextState.milestones.map((milestone) => milestone.id), serializedRows: nextState.milestones.map(milestoneRow) },
    { name: "quests", previousIds: previousState.quests.map((quest) => quest.id), nextIds: nextState.quests.map((quest) => quest.id), serializedRows: nextState.quests.map(questRow) },
    { name: "blockers", previousIds: previousState.blockers.map((blocker) => blocker.id), nextIds: nextState.blockers.map((blocker) => blocker.id), serializedRows: nextState.blockers.map(blockerRow) },
    { name: "reviews", previousIds: previousState.reviews.map((review) => review.id), nextIds: nextState.reviews.map((review) => review.id), serializedRows: nextState.reviews.map(reviewRow) },
    { name: "decisions", previousIds: previousState.decisions.map((decision) => decision.id), nextIds: nextState.decisions.map((decision) => decision.id), serializedRows: nextState.decisions.map(decisionRow) },
    { name: "artifacts", previousIds: previousState.artifacts.map((artifact) => artifact.id), nextIds: nextState.artifacts.map((artifact) => artifact.id), serializedRows: nextState.artifacts.map(artifactRow) },
    { name: "events", previousIds: previousState.events.map((event) => event.id), nextIds: nextState.events.map((event) => event.id), serializedRows: nextState.events.map(eventRow) },
    { name: "portfolio_settings", previousIds: ["default"], nextIds: ["default"], serializedRows: [portfolioSettingsRow(nextState.portfolioSettings)] },
    { name: "ui_preferences", previousIds: ["default"], nextIds: ["default"], serializedRows: [uiPreferencesRow(nextState.uiPreferences)] },
    { name: "resume_queue_items", previousIds: previousState.resumeQueueItems.map((item) => item.id), nextIds: nextState.resumeQueueItems.map((item) => item.id), serializedRows: nextState.resumeQueueItems.map(resumeQueueItemRow) },
    { name: "build_improve_decisions", previousIds: previousState.buildImproveDecisions.map((item) => item.id), nextIds: nextState.buildImproveDecisions.map((item) => item.id), serializedRows: nextState.buildImproveDecisions.map(buildImproveDecisionRow) },
    { name: "work_sessions", previousIds: previousState.workSessions.map((item) => item.id), nextIds: nextState.workSessions.map((item) => item.id), serializedRows: nextState.workSessions.map(workSessionRow) },
    { name: "bottleneck_interviews", previousIds: previousState.bottleneckInterviews.map((item) => item.id), nextIds: nextState.bottleneckInterviews.map((item) => item.id), serializedRows: nextState.bottleneckInterviews.map(bottleneckInterviewRow) },
    { name: "return_runs", previousIds: previousState.returnRuns.map((item) => item.id), nextIds: nextState.returnRuns.map((item) => item.id), serializedRows: nextState.returnRuns.map(returnRunRow) },
    { name: "meta_work_flags", previousIds: previousState.metaWorkFlags.map((flag) => flag.id), nextIds: nextState.metaWorkFlags.map((flag) => flag.id), serializedRows: nextState.metaWorkFlags.map(metaWorkFlagRow) },
    { name: "lead_metrics_daily", previousIds: previousState.leadMetricsDaily.map((item) => item.dayKey), nextIds: nextState.leadMetricsDaily.map((item) => item.dayKey), serializedRows: nextState.leadMetricsDaily.map(leadMetricsDailyRow), conflictColumn: "day_key" },
  ];

  for (const table of upsertOrder) {
    await upsertRows(table, table.conflictColumn ?? "id");
  }
}

async function writeStoredState(previousState: PersistedState, nextState: PersistedState): Promise<void> {
  if (hasSupabaseConfig()) {
    await writeSupabaseState(previousState, nextState);
    return;
  }

  await writeFallbackState(nextState);
}

async function mutateState<T>(mutator: (state: PersistedState) => { state: PersistedState; value: T }): Promise<T> {
  const previousState = await readStoredState();
  const { state, value } = mutator(previousState);
  await writeStoredState(previousState, state);
  return value;
}

export async function getAppState(): Promise<AppState> {
  noStore();
  if (shouldUseBrowserLocalPreview()) {
    return enrichState(emptyPersistedState());
  }

  const state = await readStoredState();
  return enrichState(state);
}
export async function saveGoal(input: GoalInput): Promise<Goal> {
  return mutateState((state) => {
    const result = saveGoalInState(state, input);
    return { state: result.state, value: result.goal };
  });
}

export async function replaceMap(input: MapInput): Promise<void> {
  return mutateState((state) => ({
    state: replaceMapInState(state, input),
    value: undefined,
  }));
}

export async function updateQuestStatus(questId: string, status: Quest["status"]): Promise<Quest> {
  return mutateState((state) => {
    const result = updateQuestStatusInState(state, questId, status);
    return { state: result.state, value: result.quest };
  });
}

export async function createBlocker(input: BlockerSaveInput): Promise<Blocker> {
  return mutateState((state) => {
    const result = createBlockerInState(state, input);
    return { state: result.state, value: result.blocker };
  });
}

export async function createReview(input: ReviewInput): Promise<Review> {
  return mutateState((state) => {
    const result = createReviewInState(state, input);
    return { state: result.state, value: result.review };
  });
}

export async function recordTodayPlan(goalId: string, plan: TodayPlan): Promise<void> {
  return mutateState((state) => ({
    state: recordTodayPlanInState(state, goalId, plan),
    value: undefined,
  }));
}

export async function updatePortfolioSettings(input: PortfolioSettingsInput): Promise<PortfolioSettings> {
  return mutateState((state) => {
    const result = updatePortfolioSettingsInState(state, input);
    return { state: result.state, value: result.portfolioSettings };
  });
}

export async function updateUiPreferences(input: UiPreferencesInput): Promise<UiPreferences> {
  return mutateState((state) => {
    const result = updateUiPreferencesInState(state, input);
    return { state: result.state, value: result.uiPreferences };
  });
}

export async function selectFocusGoal(input: FocusGoalInput): Promise<Goal> {
  return mutateState((state) => {
    const result = selectFocusGoalInState(state, input);
    return { state: result.state, value: result.goal };
  });
}

export async function parkGoal(input: ParkGoalInput): Promise<Goal> {
  return mutateState((state) => {
    const result = parkGoalInState(state, input);
    return { state: result.state, value: result.goal };
  });
}

export async function resumeGoal(input: ResumeGoalInput): Promise<Goal> {
  return mutateState((state) => {
    const result = resumeGoalInState(state, input);
    return { state: result.state, value: result.goal };
  });
}

export async function recordBuildImproveDecision(input: BuildImproveCheckInput): Promise<BuildImproveDecision> {
  return mutateState((state) => {
    const result = recordBuildImproveDecisionInState(state, input);
    return { state: result.state, value: result.decision };
  });
}

export async function startWorkSession(input: WorkSessionStartInput): Promise<WorkSession> {
  return mutateState((state) => {
    const result = startWorkSessionInState(state, input);
    return { state: result.state, value: result.session };
  });
}

export async function finishWorkSession(input: WorkSessionFinishInput): Promise<WorkSession> {
  return mutateState((state) => {
    const result = finishWorkSessionInState(state, input);
    return { state: result.state, value: result.session };
  });
}

export async function recordReturnInterview(input: ReturnInterviewInput): Promise<BottleneckInterview> {
  return mutateState((state) => {
    const result = recordReturnInterviewInState(state, input);
    return { state: result.state, value: result.interview };
  });
}

export async function recordReturnRun(input: ReturnRunInput): Promise<ReturnRun> {
  return mutateState((state) => {
    const result = recordReturnRunInState(state, input);
    return { state: result.state, value: result.returnRun };
  });
}
