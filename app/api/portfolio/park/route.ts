import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { parkGoal } from "@/lib/quest-agent/server/store";
import { parkGoalInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = parkGoalInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid park goal payload.", 400);
    }

    const goal = await parkGoal(payload.data);
    return jsonNoStore({ data: goal });
  } catch (error) {
    logRouteError("api/portfolio/park", error);
    return jsonError("Failed to park goal.", 500);
  }
}
