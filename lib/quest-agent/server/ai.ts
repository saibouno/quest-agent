import "server-only";

import {
  buildHeuristicBlockerReroute,
  buildHeuristicIntakeRefinement,
  buildHeuristicMapDraft,
  buildHeuristicReviewFocusReasons,
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
  ReviewFocusCandidateInput,
  ReviewFocusCandidateReason,
  TodayPlan,
  UiLocale,
} from "@/lib/quest-agent/types";

const openAiModel = process.env.OPENAI_MODEL || "gpt-5-mini";

function withLocaleInstruction(instructions: string, locale: UiLocale): string {
  const localeInstruction =
    locale === "ja"
      ? [
          "Respond in natural Japanese for a non-engineer product UI.",
          "Use short, calm sentences in a gentle plain style.",
          "Keep the wording concrete and easy to understand.",
          "Do not sound technical, moralizing, or overly formal.",
        ].join(" ")
      : [
          "Respond in concise natural English for a non-engineer product UI.",
          "Use short, calm sentences with concrete wording.",
          "Do not sound technical, moralizing, or overly formal.",
        ].join(" ");

  return `${instructions}\n\n${localeInstruction}`;
}

async function callStructuredOutput<T>(
  name: string,
  instructions: string,
  prompt: string,
  schema: Record<string, unknown>,
  locale: UiLocale,
): Promise<T | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel,
        instructions: withLocaleInstruction(instructions, locale),
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
  } catch {
    return null;
  }
}

function normalizeGeneratedString(value: string, locale: UiLocale): string {
  const collapsed = value
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[•●▪■]\s*/g, "")
    .trim()
    .replace(/^[「『"'\s]+|[」』"'\s]+$/g, "");

  const localeTidy = locale === "ja"
    ? collapsed
        .replace(/\s+([。、！？」])/g, "$1")
        .replace(/([「『])\s+/g, "$1")
    : collapsed.replace(/\s{2,}/g, " ");

  return localeTidy.length > 240 ? `${localeTidy.slice(0, 239).trimEnd()}…` : localeTidy;
}

function normalizeGeneratedValue<T>(value: T, locale: UiLocale): T {
  if (typeof value === "string") {
    return normalizeGeneratedString(value, locale) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeGeneratedValue(item, locale)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, normalizeGeneratedValue(item, locale)]),
    ) as T;
  }

  return value;
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

const reviewFocusReasonsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reasons"],
  properties: {
    reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["goalId", "reason"],
        properties: {
          goalId: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export async function generateIntakeRefinement(
  input: {
    title: string;
    description: string;
    why: string;
    deadline?: string | null;
    successCriteria: string[];
    currentState: string;
    constraints: string[];
    concerns: string;
    todayCapacity: string;
  },
  locale: UiLocale = "ja",
): Promise<IntakeRefinement> {
  const normalizedInput = { ...input, deadline: input.deadline ?? null };
  const fallback = buildHeuristicIntakeRefinement(normalizedInput, locale);
  const prompt = JSON.stringify(normalizedInput, null, 2);
  const instructions = await buildWorkflowInstructions("intake-refine");
  const result = await callStructuredOutput<Omit<IntakeRefinement, "mode">>(
    "quest_agent_intake_refinement",
    instructions,
    prompt,
    refinementSchema,
    locale,
  );

  return result ? { ...normalizeGeneratedValue(result, locale), mode: "ai" } : fallback;
}

export async function generateQuestMap(goal: Goal, locale: UiLocale = "ja"): Promise<MapDraft> {
  const fallback = buildHeuristicMapDraft(goal, locale);
  const prompt = JSON.stringify(goal, null, 2);
  const instructions = await buildWorkflowInstructions("generate-map");
  const result = await callStructuredOutput<Omit<MapDraft, "mode">>(
    "quest_agent_map",
    instructions,
    prompt,
    mapDraftSchema,
    locale,
  );

  return result ? { ...normalizeGeneratedValue(result, locale), mode: "ai" } : fallback;
}

export async function generateTodayPlan(
  goal: Goal,
  quests: Quest[],
  blockers: Blocker[],
  latestReview?: Review,
  locale: UiLocale = "ja",
): Promise<TodayPlan> {
  const fallback = buildHeuristicTodayPlan(goal, quests, blockers, latestReview, locale);
  const prompt = JSON.stringify({ goal, quests, blockers, latestReview }, null, 2);
  const instructions = await buildWorkflowInstructions("plan-today");
  const result = await callStructuredOutput<Omit<TodayPlan, "mode">>(
    "quest_agent_today_plan",
    instructions,
    prompt,
    todayPlanSchema,
    locale,
  );

  return result ? { ...normalizeGeneratedValue(result, locale), mode: "ai" } : fallback;
}

export async function generateBlockerReroute(
  goal: Goal,
  blocker: { title: string; description: string; blockerType: string },
  locale: UiLocale = "ja",
): Promise<BlockerReroute> {
  const fallback = buildHeuristicBlockerReroute(goal, blocker, locale);
  const prompt = JSON.stringify({ goal, blocker }, null, 2);
  const instructions = await buildWorkflowInstructions("reroute-from-blocker");
  const result = await callStructuredOutput<Omit<BlockerReroute, "mode">>(
    "quest_agent_blocker_reroute",
    instructions,
    prompt,
    blockerSchema,
    locale,
  );

  return result ? { ...normalizeGeneratedValue(result, locale), mode: "ai" } : fallback;
}


export async function generateReviewFocusReasons(
  candidates: ReviewFocusCandidateInput[],
  locale: UiLocale = "ja",
): Promise<ReviewFocusCandidateReason[]> {
  const fallback = buildHeuristicReviewFocusReasons(candidates, locale);
  if (!candidates.length) {
    return fallback;
  }

  const prompt = JSON.stringify({ candidates }, null, 2);
  const instructions = [
    "You are helping Quest Agent explain why each goal is a good next focus candidate.",
    "Use only the candidate data you are given.",
    "Return exactly one short sentence for each candidate.",
    "Do not moralize. Do not mention missing data. Keep the wording concrete and calm.",
    locale === "ja"
      ? "Write natural Japanese that feels calm and easy to read for a non-engineer."
      : "Write natural product English that feels calm and easy to read.",
  ].join("\n");

  const result = await callStructuredOutput<{ reasons: Array<{ goalId: string; reason: string }> }>(
    "quest_agent_review_focus_reasons",
    instructions,
    prompt,
    reviewFocusReasonsSchema,
    locale,
  );

  if (!result?.reasons?.length) {
    return fallback;
  }

  const fallbackMap = new Map(fallback.map((item) => [item.goalId, item]));
  const aiMap = new Map(
    result.reasons
      .filter((item) => typeof item.goalId === "string" && typeof item.reason === "string" && item.reason.trim().length > 0)
      .map((item) => [item.goalId, normalizeGeneratedString(item.reason, locale)]),
  );

  return candidates.map((candidate) => {
    const aiReason = aiMap.get(candidate.goalId);
    if (aiReason) {
      return {
        goalId: candidate.goalId,
        reason: aiReason,
        mode: "ai",
      };
    }

    return fallbackMap.get(candidate.goalId) ?? {
      goalId: candidate.goalId,
      reason: locale === "ja" ? "\u4eca\u9031\u306e\u672c\u4e38\u5019\u88dc\u3068\u3057\u3066\u6574\u7406\u3057\u3084\u3059\u3044" : "This looks easy to organize as a front-slot candidate this week.",
      mode: "heuristic",
    };
  });
}




