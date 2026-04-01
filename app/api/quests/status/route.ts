import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { updateQuestStatus } from "@/lib/quest-agent/server/store";
import { questStatusUpdateSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = questStatusUpdateSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid quest status payload.", 400);
    }

    const quest = await updateQuestStatus(payload.data.questId, payload.data.status);
    return jsonNoStore({ data: quest });
  } catch (error) {
    logRouteError("api/quests/status", error);
    return jsonError("Failed to update quest.", 500);
  }
}
