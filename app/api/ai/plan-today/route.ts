import { generateTodayPlan } from "@/lib/quest-agent/server/ai";
import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { getAppState, recordTodayPlan } from "@/lib/quest-agent/server/store";
import { planTodayRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = planTodayRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid today plan payload.", 400);
    }

    const state = await getAppState();
    const goal = payload.data.goalSnapshot ?? (payload.data.goalId ? state.goals.find((item) => item.id === payload.data.goalId) : null);
    if (!goal) {
      return jsonError("Goal not found.", 404);
    }

    const quests = payload.data.questSnapshots ?? state.quests.filter((quest) => quest.goalId === goal.id);
    const blockers = payload.data.blockerSnapshots ?? state.blockers.filter((blocker) => blocker.goalId === goal.id);
    const latestReview = payload.data.latestReviewSnapshot ?? state.reviews.find((review) => review.goalId === goal.id);
    const plan = await generateTodayPlan(goal, quests, blockers, latestReview ?? undefined, payload.data.locale);

    if (!payload.data.goalSnapshot) {
      await recordTodayPlan(goal.id, plan);
    }

    return jsonNoStore({ data: plan });
  } catch (error) {
    logRouteError("api/ai/plan-today", error);
    return jsonError("Failed to generate today's route.", 500);
  }
}
