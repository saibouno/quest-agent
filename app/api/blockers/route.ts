import { generateBlockerReroute } from "@/lib/quest-agent/server/ai";
import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { createBlocker, getAppState } from "@/lib/quest-agent/server/store";
import { blockerInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = blockerInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid blocker payload.", 400);
    }

    const state = await getAppState();
    const goal = state.goals.find((item) => item.id === payload.data.goalId);
    if (!goal) {
      return jsonError("Goal not found.", 404);
    }

    const reroute = await generateBlockerReroute(goal, {
      title: payload.data.title,
      description: payload.data.description,
      blockerType: payload.data.blockerType,
    });

    const blocker = await createBlocker({
      ...payload.data,
      suggestedNextStep: `${reroute.nextStep} / ${reroute.alternateRoute}`,
      acceptedReroute: reroute,
    });

    return jsonNoStore({ data: blocker, reroute });
  } catch (error) {
    logRouteError("api/blockers", error);
    return jsonError("Failed to create blocker.", 500);
  }
}
