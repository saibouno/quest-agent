import { generateQuestMap } from "@/lib/quest-agent/server/ai";
import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { generateMapRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = generateMapRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid Quest Map payload.", 400);
    }

    const goal = {
      id: payload.data.goalId,
      title: payload.data.title,
      description: payload.data.description,
      why: payload.data.why,
      deadline: payload.data.deadline || null,
      successCriteria: payload.data.successCriteria,
      currentState: payload.data.currentState,
      constraints: payload.data.constraints,
      concerns: payload.data.concerns,
      todayCapacity: "",
      status: "active" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const map = await generateQuestMap(goal, payload.data.locale);
    return jsonNoStore({ data: map });
  } catch (error) {
    logRouteError("api/ai/generate-map", error);
    return jsonError("Failed to generate Quest Map.", 500);
  }
}
