import "server-only";

import {
  buildHeuristicBlockerReroute,
  buildHeuristicIntakeRefinement,
  buildHeuristicMapDraft,
  buildHeuristicTodayPlan,
} from "@/lib/quest-agent/derive";
import { buildWorkflowInstructions } from "@/lib/quest-agent/server/orchestration";
import type {
  Blocker,
  BlockerReroute,
  Goal,
  IntakeRefinement,
  MapDraft,
  Quest,
  Review,
  TodayPlan,
} from "@/lib/quest-agent/types";

const openAiModel = process.env.OPENAI_MODEL || "gpt-5-mini";

async function callStructuredOutput<T>(name: string, instructions: string, prompt: string, schema: Record<string, unknown>): Promise<T | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openAiModel,
      instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name,
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as { output_text?: string };
  if (!body.output_text) {
    return null;
  }

  return JSON.parse(body.output_text) as T;
}

const refinementSchema = {
  type: "object",
  additionalProperties: false,
  required: ["goalTitle", "goalSummary", "successCriteria", "constraintsToWatch", "openQuestions", "firstRouteNote"],
  properties: {
    goalTitle: { type: "string" },
    goalSummary: { type: "string" },
    successCriteria: { type: "array", items: { type: "string" } },
    constraintsToWatch: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
    firstRouteNote: { type: "string" },
  },
} as const;

const mapDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["routeSummary", "milestones"],
  properties: {
    routeSummary: { type: "string" },
    milestones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tempId", "title", "description", "targetDate", "quests"],
        properties: {
          tempId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          targetDate: { type: ["string", "null"] },
          quests: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "description", "priority", "dueDate", "estimatedMinutes", "questType"],
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                priority: { type: "string", enum: ["high", "medium", "low"] },
                dueDate: { type: ["string", "null"] },
                estimatedMinutes: { type: ["integer", "null"] },
                questType: { type: "string", enum: ["main", "side"] },
              },
            },
          },
        },
      },
    },
  },
} as const;

const todayPlanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["theme", "quests", "notes"],
  properties: {
    theme: { type: "string" },
    quests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["questId", "title", "reason", "focusMinutes", "successHint", "status"],
        properties: {
          questId: { type: ["string", "null"] },
          title: { type: "string" },
          reason: { type: "string" },
          focusMinutes: { type: "integer" },
          successHint: { type: "string" },
          status: { type: "string" },
        },
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
} as const;

const blockerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["blockerLabel", "diagnosis", "nextStep", "alternateRoute", "reframing"],
  properties: {
    blockerLabel: { type: "string" },
    diagnosis: { type: "string" },
    nextStep: { type: "string" },
    alternateRoute: { type: "string" },
    reframing: { type: "string" },
  },
} as const;

export async function generateIntakeRefinement(input: {
  title: string;
  description: string;
  why: string;
  deadline?: string | null;
  successCriteria: string[];
  currentState: string;
  constraints: string[];
  concerns: string;
  todayCapacity: string;
}): Promise<IntakeRefinement> {
  const fallback = buildHeuristicIntakeRefinement({ ...input, deadline: input.deadline ?? null });
  const prompt = JSON.stringify(input, null, 2);
  const instructions = await buildWorkflowInstructions("intake-refine");
  const result = await callStructuredOutput<Omit<IntakeRefinement, "mode">>(
    "quest_agent_intake_refinement",
    instructions,
    prompt,
    refinementSchema,
  );

  return result ? { ...result, mode: "ai" } : fallback;
}

export async function generateQuestMap(goal: Goal): Promise<MapDraft> {
  const fallback = buildHeuristicMapDraft(goal);
  const prompt = JSON.stringify(goal, null, 2);
  const instructions = await buildWorkflowInstructions("generate-map");
  const result = await callStructuredOutput<Omit<MapDraft, "mode">>(
    "quest_agent_map",
    instructions,
    prompt,
    mapDraftSchema,
  );

  return result ? { ...result, mode: "ai" } : fallback;
}

export async function generateTodayPlan(goal: Goal, quests: Quest[], blockers: Blocker[], latestReview?: Review): Promise<TodayPlan> {
  const fallback = buildHeuristicTodayPlan(goal, quests, blockers, latestReview);
  const prompt = JSON.stringify({ goal, quests, blockers, latestReview }, null, 2);
  const instructions = await buildWorkflowInstructions("plan-today");
  const result = await callStructuredOutput<Omit<TodayPlan, "mode">>(
    "quest_agent_today_plan",
    instructions,
    prompt,
    todayPlanSchema,
  );

  return result ? { ...result, mode: "ai" } : fallback;
}

export async function generateBlockerReroute(goal: Goal, blocker: { title: string; description: string; blockerType: string }): Promise<BlockerReroute> {
  const fallback = buildHeuristicBlockerReroute(goal, blocker);
  const prompt = JSON.stringify({ goal, blocker }, null, 2);
  const instructions = await buildWorkflowInstructions("reroute-from-blocker");
  const result = await callStructuredOutput<Omit<BlockerReroute, "mode">>(
    "quest_agent_blocker_reroute",
    instructions,
    prompt,
    blockerSchema,
  );

  return result ? { ...result, mode: "ai" } : fallback;
}