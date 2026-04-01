import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { resumeGoal } from "@/lib/quest-agent/server/store";
import { resumeGoalInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = resumeGoalInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid resume goal payload.", 400);
    }

    const goal = await resumeGoal(payload.data);
    return jsonNoStore({ data: goal });
  } catch (error) {
    logRouteError("api/portfolio/resume", error);
    return jsonError("Failed to resume goal.", 500);
  }
}
