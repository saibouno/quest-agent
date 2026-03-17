import type { RoleSchemaScaffold, WorkflowScaffold } from "@/lib/quest-agent/types";

const stringArray = {
  type: "array",
  items: { type: "string" },
} as const;

export const scoutOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["goalSummary", "deadline", "constraints", "successCriteria", "currentState", "openQuestions", "collectedContext"],
  properties: {
    goalSummary: { type: "string" },
    deadline: { type: ["string", "null"] },
    constraints: stringArray,
    successCriteria: stringArray,
    currentState: stringArray,
    openQuestions: stringArray,
    collectedContext: stringArray,
  },
} as const;

export const realistOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["milestones", "feasibilityNotes", "todayCandidateQuests", "dependencyNotes"],
  properties: {
    milestones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "reason"],
        properties: {
          title: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    feasibilityNotes: stringArray,
    todayCandidateQuests: stringArray,
    dependencyNotes: stringArray,
  },
} as const;

export const skepticOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["risks", "likelyWastedStalls", "assumptionsToTest", "simplificationIdeas"],
  properties: {
    risks: stringArray,
    likelyWastedStalls: stringArray,
    assumptionsToTest: stringArray,
    simplificationIdeas: stringArray,
  },
} as const;

export const routerOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mainRoute", "alternateRoutes", "todayPlan", "firstNextAction"],
  properties: {
    mainRoute: {
      type: "object",
      additionalProperties: false,
      required: ["routeType", "name", "why"],
      properties: {
        routeType: {
          type: "string",
          enum: [
            "direct_route",
            "lightweight_detour",
            "temporary_assumption_route",
            "dependency_wait_route",
            "information_gathering_route",
            "energy_matched_route",
          ],
        },
        name: { type: "string" },
        why: { type: "string" },
      },
    },
    alternateRoutes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["routeType", "name", "whenToUse"],
        properties: {
          routeType: {
            type: "string",
            enum: [
              "direct_route",
              "lightweight_detour",
              "temporary_assumption_route",
              "dependency_wait_route",
              "information_gathering_route",
              "energy_matched_route",
            ],
          },
          name: { type: "string" },
          whenToUse: { type: "string" },
        },
      },
    },
    todayPlan: {
      type: "object",
      additionalProperties: false,
      required: ["mainQuest", "sideQuests"],
      properties: {
        mainQuest: { type: "string" },
        sideQuests: stringArray,
      },
    },
    firstNextAction: { type: "string" },
  },
} as const;

export const archivistOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["updatedStateSummary", "events", "decisionRecords", "summarySnapshot"],
  properties: {
    updatedStateSummary: { type: "string" },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "payload"],
        properties: {
          type: { type: "string" },
          payload: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    decisionRecords: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "reason"],
        properties: {
          title: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    summarySnapshot: { type: "string" },
  },
} as const;

export const roleSchemas: Record<string, RoleSchemaScaffold> = {
  scout: { name: "scout_output", schema: scoutOutputSchema },
  realist: { name: "realist_output", schema: realistOutputSchema },
  skeptic: { name: "skeptic_output", schema: skepticOutputSchema },
  router: { name: "router_output", schema: routerOutputSchema },
  archivist: { name: "archivist_output", schema: archivistOutputSchema },
};

export const workflowScaffolds: Record<string, WorkflowScaffold> = {
  "intake-refine": {
    key: "intake-refine",
    loop: "normal",
    roles: ["scout", "realist", "router", "archivist"],
    finalRole: "router",
  },
  "generate-map": {
    key: "generate-map",
    loop: "normal",
    roles: ["scout", "realist", "router", "archivist"],
    finalRole: "router",
  },
  "plan-today": {
    key: "plan-today",
    loop: "normal",
    roles: ["realist", "router", "archivist"],
    finalRole: "router",
  },
  "reroute-from-blocker": {
    key: "reroute-from-blocker",
    loop: "stuck",
    roles: ["scout", "skeptic", "realist", "router", "archivist"],
    finalRole: "router",
  },
};