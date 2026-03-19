import { NextResponse } from "next/server";

import { generateTodayPlan } from "@/lib/quest-agent/server/ai";
import { getAppState, recordTodayPlan } from "@/lib/quest-agent/server/store";
import { planTodayRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  try {
    const payload = planTodayRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message ?? "Invalid today plan payload." }, { status: 400 });
    }

    const state = await getAppState();
    const goal = payload.data.goalSnapshot ?? (payload.data.goalId ? state.goals.find((item) => item.id === payload.data.goalId) : null);
    if (!goal) {
      return NextResponse.json({ error: "Goal not found." }, { status: 404 });
    }

    const quests = payload.data.questSnapshots ?? state.quests.filter((quest) => quest.goalId === goal.id);
    const blockers = payload.data.blockerSnapshots ?? state.blockers.filter((blocker) => blocker.goalId === goal.id);
    const latestReview = payload.data.latestReviewSnapshot ?? state.reviews.find((review) => review.goalId === goal.id);
    const plan = await generateTodayPlan(goal, quests, blockers, latestReview ?? undefined);

    if (!payload.data.goalSnapshot) {
      await recordTodayPlan(goal.id, plan);
    }

    return NextResponse.json({ data: plan });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate today's route." }, { status: 500 });
  }
}