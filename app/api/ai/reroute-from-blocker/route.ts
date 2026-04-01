import { generateBlockerReroute } from "@/lib/quest-agent/server/ai";
import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { getAppState } from "@/lib/quest-agent/server/store";
import { rerouteRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = rerouteRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid reroute payload.", 400);
    }

    const state = await getAppState();
    const goal = payload.data.goalSnapshot ?? (payload.data.goalId ? state.goals.find((item) => item.id === payload.data.goalId) : null);
    if (!goal) {
      return jsonError("Goal not found.", 404);
    }

    const reroute = await generateBlockerReroute(goal, {
      title: payload.data.title,
      description: payload.data.description,
      blockerType: payload.data.blockerType,
    }, payload.data.locale);

    return jsonNoStore({ data: reroute });
  } catch (error) {
    logRouteError("api/ai/reroute-from-blocker", error);
    return jsonError("Failed to reroute blocker.", 500);
  }
}
