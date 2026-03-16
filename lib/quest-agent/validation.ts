import { z } from "zod";

import {
  blockerStatuses,
  blockerTypes,
  goalStatuses,
  priorityLevels,
  questStatuses,
  questTypes,
  severityLevels,
} from "@/lib/quest-agent/types";

export const lineArraySchema = z.array(z.string().trim().min(1)).default([]);

export const goalInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Goal title is required"),
  description: z.string().trim().default(""),
  why: z.string().trim().default(""),
  deadline: z.string().trim().optional().nullable(),
  successCriteria: lineArraySchema,
  currentState: z.string().trim().default(""),
  constraints: lineArraySchema,
  concerns: z.string().trim().default(""),
  todayCapacity: z.string().trim().default(""),
  status: z.enum(goalStatuses).default("active"),
  refined: z.boolean().optional().default(false),
});

export const mapDraftQuestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  priority: z.enum(priorityLevels).default("medium"),
  dueDate: z.string().trim().optional().nullable(),
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

export const intakeRefineRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  why: z.string().trim().default(""),
  deadline: z.string().trim().optional().nullable(),
  successCriteria: lineArraySchema,
  currentState: z.string().trim().default(""),
  constraints: lineArraySchema,
  concerns: z.string().trim().default(""),
  todayCapacity: z.string().trim().default(""),
});

export const generateMapRequestSchema = z.object({
  goalId: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  why: z.string().trim().default(""),
  deadline: z.string().trim().optional().nullable(),
  successCriteria: lineArraySchema,
  currentState: z.string().trim().default(""),
  constraints: lineArraySchema,
  concerns: z.string().trim().default(""),
});

export const planTodayRequestSchema = z.object({
  goalId: z.string().uuid(),
});

export const rerouteRequestSchema = z.object({
  goalId: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  blockerType: z.enum(blockerTypes).default("unknown"),
  relatedQuestId: z.string().uuid().optional().nullable(),
});
