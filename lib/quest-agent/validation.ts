import { z } from "zod";

import {
  blockerStatuses,
  blockerTypes,
  bottleneckTypes,
  buildImproveModes,
  goalStatuses,
  mainConnectionKinds,
  metaWorkFlagTypes,
  priorityLevels,
  questStatuses,
  questTypes,
  resumeTriggerTypes,
  returnDecisions,
  sessionCategories,
  uiLocales,
  severityLevels,
  stopModes,
} from "@/lib/quest-agent/types";

export const lineArraySchema = z.array(z.string().trim().min(1)).default([]);

const goalSnapshotSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  why: z.string().trim().default(""),
  deadline: z.string().trim().nullable().default(null),
  successCriteria: lineArraySchema,
  currentState: z.string().trim().default(""),
  constraints: lineArraySchema,
  concerns: z.string().trim().default(""),
  todayCapacity: z.string().trim().default(""),
  status: z.enum(goalStatuses).default("active"),
  createdAt: z.string().trim(),
  updatedAt: z.string().trim(),
});

const questSnapshotSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  milestoneId: z.string().uuid().nullable(),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  priority: z.enum(priorityLevels).default("medium"),
  status: z.enum(questStatuses).default("planned"),
  dueDate: z.string().trim().nullable().default(null),
  estimatedMinutes: z.number().int().positive().nullable().default(null),
  questType: z.enum(questTypes).default("main"),
  createdAt: z.string().trim(),
  updatedAt: z.string().trim(),
});

const blockerSnapshotSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  relatedQuestId: z.string().uuid().nullable(),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  blockerType: z.enum(blockerTypes).default("unknown"),
  severity: z.enum(severityLevels).default("medium"),
  status: z.enum(blockerStatuses).default("open"),
  suggestedNextStep: z.string().trim().default(""),
  detectedAt: z.string().trim(),
});

const reviewSnapshotSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  periodStart: z.string().trim().min(1),
  periodEnd: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  learnings: z.string().trim().default(""),
  rerouteNote: z.string().trim().default(""),
  nextFocus: z.string().trim().default(""),
  createdAt: z.string().trim(),
});

const reviewFocusCandidateSchema = z.object({
  goalId: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  currentState: z.string().trim().default(""),
  status: z.enum(goalStatuses),
  isInResumeQueue: z.boolean(),
  isOverdue: z.boolean(),
  openBlockerCount: z.number().int().min(0),
  activeQuestCount: z.number().int().min(0),
  updatedAt: z.string().trim().min(1),
});

export const goalInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Goal title is required"),
  description: z.string().trim().default(""),
  why: z.string().trim().default(""),
  deadline: z.string().trim().nullable().default(null),
  successCriteria: lineArraySchema,
  currentState: z.string().trim().default(""),
  constraints: lineArraySchema,
  concerns: z.string().trim().default(""),
  todayCapacity: z.string().trim().default(""),
  status: z.enum(goalStatuses).default("active"),
  refined: z.boolean().optional().default(false),
});

export const portfolioSettingsInputSchema = z.object({
  wipLimit: z.number().int().min(1).max(3),
});

export const uiPreferencesInputSchema = z.object({
  locale: z.enum(uiLocales),
});

export const buildImproveCheckInputSchema = z.object({
  goalId: z.string().uuid(),
  questId: z.string().uuid().optional().nullable(),
  category: z.enum(sessionCategories),
  mainConnection: z.enum(mainConnectionKinds),
  artifactCommitment: z.string().trim().min(1, "Artifact commitment is required."),
  timeboxMinutes: z.number().int().min(5).max(180),
  doneWhen: z.string().trim().min(1, "An end condition is required."),
});

export const workSessionStartInputSchema = z.object({
  goalId: z.string().uuid(),
  questId: z.string().uuid().optional().nullable(),
  category: z.enum(sessionCategories),
  gateDecisionId: z.string().uuid(),
});

export const workSessionFinishInputSchema = z.object({
  sessionId: z.string().uuid(),
  artifactNote: z.string().trim().optional().default(""),
});

export const focusGoalInputSchema = z.object({
  goalId: z.string().uuid(),
  reason: z.string().trim().min(1, "Switch reason is required."),
});

export const parkGoalInputSchema = z.object({
  goalId: z.string().uuid(),
  stopMode: z.enum(stopModes),
  reason: z.string().trim().min(1, "A stop reason is required."),
  parkingNote: z.string().trim().min(1, "Parking note is required."),
  nextRestartStep: z.string().trim().min(1, "Next restart step is required."),
  resumeTriggerType: z.enum(resumeTriggerTypes),
  resumeTriggerText: z.string().trim().min(1, "Resume trigger is required."),
});

export const resumeGoalInputSchema = z.object({
  goalId: z.string().uuid(),
  reason: z.string().trim().optional().default("Resume from queue"),
});

export const mapDraftQuestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  priority: z.enum(priorityLevels).default("medium"),
  dueDate: z.string().trim().nullable().default(null),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
  questType: z.enum(questTypes).default("main"),
});

export const mapDraftMilestoneSchema = z.object({
  tempId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  targetDate: z.string().trim().optional().nullable(),
  quests: z.array(mapDraftQuestSchema).default([]),
});

export const mapDraftSchema = z.object({
  goalId: z.string().uuid(),
  routeSummary: z.string().trim().default(""),
  milestones: z.array(mapDraftMilestoneSchema).min(1),
  mode: z.enum(["ai", "heuristic"]).default("heuristic"),
});

export const questStatusUpdateSchema = z.object({
  questId: z.string().uuid(),
  status: z.enum(questStatuses),
});

export const blockerInputSchema = z.object({
  goalId: z.string().uuid(),
  relatedQuestId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  blockerType: z.enum(blockerTypes).default("unknown"),
  severity: z.enum(severityLevels).default("medium"),
  status: z.enum(blockerStatuses).default("open"),
});

export const reviewInputSchema = z.object({
  goalId: z.string().uuid(),
  periodStart: z.string().trim().min(1),
  periodEnd: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  learnings: z.string().trim().default(""),
  rerouteNote: z.string().trim().default(""),
  nextFocus: z.string().trim().default(""),
});

export const returnInterviewInputSchema = z.object({
  goalId: z.string().uuid(),
  mainQuest: z.string().trim().min(1, "Main quest is required."),
  primaryBottleneck: z.enum(bottleneckTypes),
  avoidanceHypothesis: z.string().trim().min(1, "Avoidance hypothesis is required."),
  smallestWin: z.string().trim().min(1, "Smallest win is required."),
});

export const returnRunInputSchema = z
  .object({
    goalId: z.string().uuid(),
    questId: z.string().uuid().optional().nullable(),
    interviewId: z.string().uuid().optional().nullable(),
    mirrorMessage: z.string().trim().min(1, "Mirror message is required."),
    diagnosisType: z.enum(bottleneckTypes),
    woopPlan: z.string().trim().min(1, "WOOP plan is required."),
    ifThenPlan: z.string().trim().default(""),
    next15mAction: z.string().trim().min(1, "Next 15m action is required."),
    decision: z.enum(returnDecisions),
    decisionNote: z.string().trim().default(""),
    reviewDate: z.string().trim().nullable().optional().default(null),
    parkingReason: z.string().trim().optional().default(""),
    parkingNote: z.string().trim().optional().default(""),
    nextRestartStep: z.string().trim().optional().default(""),
    resumeTriggerType: z.enum(resumeTriggerTypes).optional(),
    resumeTriggerText: z.string().trim().optional().default(""),
  })
  .refine((value) => {
    if (value.decision === "hold") {
      return Boolean(
        value.parkingReason.trim() &&
          value.parkingNote.trim() &&
          value.nextRestartStep.trim() &&
          value.resumeTriggerType &&
          value.resumeTriggerText.trim(),
      );
    }
    if (value.decision === "retreat") {
      return Boolean(value.parkingReason.trim() && value.parkingNote.trim() && value.reviewDate);
    }
    return true;
  }, {
    message: "Hold needs restart fields, and Retreat needs a reason plus review date.",
  });

export const intakeRefineRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  why: z.string().trim().default(""),
  deadline: z.string().trim().nullable().default(null),
  successCriteria: lineArraySchema,
  currentState: z.string().trim().default(""),
  constraints: lineArraySchema,
  concerns: z.string().trim().default(""),
  todayCapacity: z.string().trim().default(""),
  locale: z.enum(uiLocales).optional().default("ja"),
});

export const generateMapRequestSchema = z.object({
  goalId: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  why: z.string().trim().default(""),
  deadline: z.string().trim().nullable().default(null),
  successCriteria: lineArraySchema,
  currentState: z.string().trim().default(""),
  constraints: lineArraySchema,
  concerns: z.string().trim().default(""),
  locale: z.enum(uiLocales).optional().default("ja"),
});

export const planTodayRequestSchema = z
  .object({
    goalId: z.string().uuid().optional(),
    goalSnapshot: goalSnapshotSchema.optional(),
    questSnapshots: z.array(questSnapshotSchema).optional(),
    blockerSnapshots: z.array(blockerSnapshotSchema).optional(),
    latestReviewSnapshot: reviewSnapshotSchema.optional().nullable(),
    locale: z.enum(uiLocales).optional().default("ja"),
  })
  .refine((value) => Boolean(value.goalId || value.goalSnapshot), {
    message: "goalId or goalSnapshot is required",
  });

export const rerouteRequestSchema = z
  .object({
    goalId: z.string().uuid().optional(),
    title: z.string().trim().min(1),
    description: z.string().trim().default(""),
    blockerType: z.enum(blockerTypes).default("unknown"),
    relatedQuestId: z.string().uuid().optional().nullable(),
    goalSnapshot: goalSnapshotSchema.optional(),
    locale: z.enum(uiLocales).optional().default("ja"),
  })
  .refine((value) => Boolean(value.goalId || value.goalSnapshot), {
    message: "goalId or goalSnapshot is required",
  });

export const reviewFocusReasonsRequestSchema = z.object({
  currentFocusGoalId: z.string().uuid().nullable().optional().default(null),
  candidates: z.array(reviewFocusCandidateSchema).default([]),
  locale: z.enum(uiLocales).optional().default("ja"),
});

export const reservedTrackingSchemas = {
  buildImproveModes: z.enum(buildImproveModes),
  metaWorkFlagTypes: z.enum(metaWorkFlagTypes),
};
