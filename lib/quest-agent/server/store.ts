import "server-only";

import { createClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";
import { promises as fs } from "node:fs";
import path from "node:path";

import { emptyPersistedState, enrichState, makeId, nowIso } from "@/lib/quest-agent/derive";
import type {
  AppState,
  Artifact,
  Blocker,
  Decision,
  Goal,
  MapDraftMilestone,
  Milestone,
  PersistedState,
  Quest,
  QuestEvent,
  Review,
  TodayPlan,
} from "@/lib/quest-agent/types";


const fallbackPath = path.join(process.cwd(), "data", "quest-agent-fallback.json");

type GoalInput = {
  id?: string;
  title: string;
  description: string;
  why: string;
  deadline?: string | null;
  successCriteria: string[];
  currentState: string;
  constraints: string[];
  concerns: string;
  todayCapacity: string;
  status: Goal["status"];
  refined?: boolean;
};

type MapInput = {
  goalId: string;
  routeSummary: string;
  milestones: MapDraftMilestone[];
  mode: "ai" | "heuristic";
};

type BlockerInput = {
  goalId: string;
  relatedQuestId?: string | null;
  title: string;
  description: string;
  blockerType: Blocker["blockerType"];
  severity: Blocker["severity"];
  status: Blocker["status"];
  suggestedNextStep: string;
};

type ReviewInput = {
  goalId: string;
  periodStart: string;
  periodEnd: string;
  summary: string;
  learnings: string;
  rerouteNote: string;
  nextFocus: string;
};

function hasSupabaseConfig(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getStorageMode(): "supabase" | "file" {
  return hasSupabaseConfig() ? "supabase" : "file";
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
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
  return {
    ...emptyPersistedState(),
    ...JSON.parse(content),
  } as PersistedState;
}

async function writeFallbackState(state: PersistedState): Promise<void> {
  await ensureFallbackFile();
  await fs.writeFile(fallbackPath, JSON.stringify(state, null, 2), "utf8");
}

type DbRow = Record<string, unknown>;

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

async function readSupabaseState(): Promise<PersistedState> {
  const supabase = getSupabaseClient();
  const [goalsRes, milestonesRes, questsRes, blockersRes, reviewsRes, decisionsRes, artifactsRes, eventsRes] = await Promise.all([
    supabase.from("goals").select("*").order("updated_at", { ascending: false }),
    supabase.from("milestones").select("*").order("sequence", { ascending: true }),
    supabase.from("quests").select("*").order("created_at", { ascending: true }),
    supabase.from("blockers").select("*").order("detected_at", { ascending: false }),
    supabase.from("reviews").select("*").order("created_at", { ascending: false }),
    supabase.from("decisions").select("*").order("decided_at", { ascending: false }),
    supabase.from("artifacts").select("*").order("created_at", { ascending: false }),
    supabase.from("events").select("*").order("created_at", { ascending: false }),
  ]);

  const responses = [goalsRes, milestonesRes, questsRes, blockersRes, reviewsRes, decisionsRes, artifactsRes, eventsRes];
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
  };
}

export async function getAppState(): Promise<AppState> {
  noStore();
  const state = hasSupabaseConfig() ? await readSupabaseState() : await readFallbackState();
  return enrichState(state);
}

async function pauseOtherGoals(goalId: string): Promise<void> {
  if (!hasSupabaseConfig()) {
    const state = await readFallbackState();
    state.goals = state.goals.map((goal) =>
      goal.id === goalId || goal.status !== "active"
        ? goal
        : {
            ...goal,
            status: "paused",
            updatedAt: nowIso(),
          },
    );
    await writeFallbackState(state);
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("goals")
    .update({ status: "paused", updated_at: nowIso() })
    .neq("id", goalId)
    .eq("status", "active");

  if (error) {
    throw new Error(error.message);
  }
}

async function insertSupabaseEvents(events: QuestEvent[]): Promise<void> {
  if (!events.length) {
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("events").insert(
    events.map((event) => ({
      id: event.id,
      goal_id: event.goalId,
      entity_type: event.entityType,
      entity_id: event.entityId,
      type: event.type,
      payload: event.payload,
      created_at: event.createdAt,
    })),
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function saveGoal(input: GoalInput): Promise<Goal> {
  const payload = {
    title: input.title,
    description: input.description,
    why: input.why,
    deadline: input.deadline || null,
    success_criteria: input.successCriteria,
    current_state: input.currentState,
    constraints: input.constraints,
    concerns: input.concerns,
    today_capacity: input.todayCapacity,
    status: input.status,
    updated_at: nowIso(),
  };

  if (!hasSupabaseConfig()) {
    const state = await readFallbackState();
    const existing = input.id ? state.goals.find((goal) => goal.id === input.id) : null;
    const goal: Goal = existing
      ? {
          ...existing,
          title: input.title,
          description: input.description,
          why: input.why,
          deadline: input.deadline || null,
          successCriteria: input.successCriteria,
          currentState: input.currentState,
          constraints: input.constraints,
          concerns: input.concerns,
          todayCapacity: input.todayCapacity,
          status: input.status,
          updatedAt: nowIso(),
        }
      : {
          id: makeId(),
          title: input.title,
          description: input.description,
          why: input.why,
          deadline: input.deadline || null,
          successCriteria: input.successCriteria,
          currentState: input.currentState,
          constraints: input.constraints,
          concerns: input.concerns,
          todayCapacity: input.todayCapacity,
          status: input.status,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

    state.goals = [goal, ...state.goals.filter((item) => item.id !== goal.id)].map((item) =>
      goal.status === "active" && item.id !== goal.id && item.status === "active"
        ? { ...item, status: "paused", updatedAt: nowIso() }
        : item,
    );
    state.events.push(
      buildEvent(goal.id, "goal", goal.id, existing ? "goal_refined" : "goal_created", {
        title: goal.title,
        refined: input.refined ?? false,
      }),
    );
    await writeFallbackState(state);
    return goal;
  }

  const supabase = getSupabaseClient();
  const response = input.id
    ? await supabase.from("goals").update(payload).eq("id", input.id).select("*").single()
    : await supabase.from("goals").insert(payload).select("*").single();
  if (response.error || !response.data) {
    throw new Error(response.error?.message ?? "Failed to save goal.");
  }

  const goal = toGoal(response.data);
  if (goal.status === "active") {
    await pauseOtherGoals(goal.id);
  }
  await insertSupabaseEvents([
    buildEvent(goal.id, "goal", goal.id, input.id ? "goal_refined" : "goal_created", {
      title: goal.title,
      refined: input.refined ?? false,
    }),
  ]);
  return goal;
}

export async function replaceMap(input: MapInput): Promise<void> {
  const now = nowIso();
  const milestoneRecords = input.milestones.map((milestone, index) => ({
    id: makeId(),
    goalId: input.goalId,
    title: milestone.title,
    description: milestone.description,
    sequence: index + 1,
    targetDate: milestone.targetDate || null,
    status: index === 0 ? ("active" as const) : ("planned" as const),
    createdAt: now,
  }));

  const questRecords = milestoneRecords.flatMap((milestone, milestoneIndex) => {
    const source = input.milestones[milestoneIndex];
    return source.quests.map((quest, questIndex) => ({
      id: makeId(),
      goalId: input.goalId,
      milestoneId: milestone.id,
      title: quest.title,
      description: quest.description,
      priority: quest.priority,
      status: milestoneIndex === 0 && questIndex === 0 ? ("ready" as const) : ("planned" as const),
      dueDate: quest.dueDate || null,
      estimatedMinutes: quest.estimatedMinutes ?? null,
      questType: quest.questType,
      createdAt: now,
      updatedAt: now,
    }));
  });

  if (!hasSupabaseConfig()) {
    const state = await readFallbackState();
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
    await writeFallbackState(state);
    return;
  }

  const supabase = getSupabaseClient();
  const deleteQuests = await supabase.from("quests").delete().eq("goal_id", input.goalId);
  if (deleteQuests.error) {
    throw new Error(deleteQuests.error.message);
  }
  const deleteMilestones = await supabase.from("milestones").delete().eq("goal_id", input.goalId);
  if (deleteMilestones.error) {
    throw new Error(deleteMilestones.error.message);
  }

  if (milestoneRecords.length) {
    const { error } = await supabase.from("milestones").insert(
      milestoneRecords.map((milestone) => ({
        id: milestone.id,
        goal_id: milestone.goalId,
        title: milestone.title,
        description: milestone.description,
        sequence: milestone.sequence,
        target_date: milestone.targetDate,
        status: milestone.status,
        created_at: milestone.createdAt,
      })),
    );
    if (error) {
      throw new Error(error.message);
    }
  }

  if (questRecords.length) {
    const { error } = await supabase.from("quests").insert(
      questRecords.map((quest) => ({
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
      })),
    );
    if (error) {
      throw new Error(error.message);
    }
  }

  await insertSupabaseEvents([
    ...milestoneRecords.map((milestone) => buildEvent(input.goalId, "milestone", milestone.id, "milestone_defined", { title: milestone.title })),
    ...questRecords.map((quest) => buildEvent(input.goalId, "quest", quest.id, "quest_created", { title: quest.title })),
    buildEvent(input.goalId, "system", input.goalId, "route_changed", {
      routeSummary: input.routeSummary,
      mode: input.mode,
    }),
  ]);
}

export async function updateQuestStatus(questId: string, status: Quest["status"]): Promise<Quest> {
  const eventType = status === "in_progress" ? "quest_started" : status === "completed" ? "quest_completed" : "quest_updated";

  if (!hasSupabaseConfig()) {
    const state = await readFallbackState();
    const existing = state.quests.find((quest) => quest.id === questId);
    if (!existing) {
      throw new Error("Quest not found.");
    }
    const quest = { ...existing, status, updatedAt: nowIso() };
    state.quests = state.quests.map((item) => (item.id === questId ? quest : item));
    state.events.push(buildEvent(quest.goalId, "quest", quest.id, eventType, { status }));
    await writeFallbackState(state);
    return quest;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("quests")
    .update({ status, updated_at: nowIso() })
    .eq("id", questId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update quest.");
  }
  const quest = toQuest(data);
  await insertSupabaseEvents([buildEvent(quest.goalId, "quest", quest.id, eventType, { status })]);
  return quest;
}

export async function createBlocker(input: BlockerInput): Promise<Blocker> {
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

  if (!hasSupabaseConfig()) {
    const state = await readFallbackState();
    state.blockers = [blocker, ...state.blockers];
    state.events.push(buildEvent(blocker.goalId, "blocker", blocker.id, "blocker_detected", { title: blocker.title }));
    await writeFallbackState(state);
    return blocker;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("blockers")
    .insert({
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
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create blocker.");
  }
  const saved = toBlocker(data);
  await insertSupabaseEvents([buildEvent(saved.goalId, "blocker", saved.id, "blocker_detected", { title: saved.title })]);
  return saved;
}

export async function createReview(input: ReviewInput): Promise<Review> {
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

  if (!hasSupabaseConfig()) {
    const state = await readFallbackState();
    state.reviews = [review, ...state.reviews];
    state.events.push(buildEvent(review.goalId, "review", review.id, "weekly_review_done", { summary: review.summary }));
    if (review.rerouteNote) {
      state.events.push(buildEvent(review.goalId, "system", review.goalId, "route_changed", { rerouteNote: review.rerouteNote }));
    }
    await writeFallbackState(state);
    return review;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("reviews")
    .insert({
      id: review.id,
      goal_id: review.goalId,
      period_start: review.periodStart,
      period_end: review.periodEnd,
      summary: review.summary,
      learnings: review.learnings,
      reroute_note: review.rerouteNote,
      next_focus: review.nextFocus,
      created_at: review.createdAt,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create review.");
  }
  const saved = toReview(data);
  const events = [buildEvent(saved.goalId, "review", saved.id, "weekly_review_done", { summary: saved.summary })];
  if (saved.rerouteNote) {
    events.push(buildEvent(saved.goalId, "system", saved.goalId, "route_changed", { rerouteNote: saved.rerouteNote }));
  }
  await insertSupabaseEvents(events);
  return saved;
}

export async function recordTodayPlan(goalId: string, plan: TodayPlan): Promise<void> {
  const event = buildEvent(goalId, "system", goalId, "today_plan_generated", {
    mode: plan.mode,
    theme: plan.theme,
    quests: plan.quests.map((quest) => quest.title),
  });

  if (!hasSupabaseConfig()) {
    const state = await readFallbackState();
    state.events.push(event);
    await writeFallbackState(state);
    return;
  }

  await insertSupabaseEvents([event]);
}






