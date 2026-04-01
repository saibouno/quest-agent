import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { saveGoal } from "@/lib/quest-agent/server/store";
import { goalInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = goalInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid goal payload.", 400);
    }

    const goal = await saveGoal(payload.data);
    return jsonNoStore({ data: goal });
  } catch (error) {
    logRouteError("api/goals", error);
    return jsonError("Failed to save goal.", 500);
  }
}
