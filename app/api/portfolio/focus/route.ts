import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { selectFocusGoal } from "@/lib/quest-agent/server/store";
import { focusGoalInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = focusGoalInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid focus goal payload.", 400);
    }

    const goal = await selectFocusGoal(payload.data);
    return jsonNoStore({ data: goal });
  } catch (error) {
    logRouteError("api/portfolio/focus", error);
    return jsonError("Failed to change focus goal.", 500);
  }
}
