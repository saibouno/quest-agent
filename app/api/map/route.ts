import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { replaceMap } from "@/lib/quest-agent/server/store";
import { mapDraftSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = mapDraftSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid map payload.", 400);
    }

    await replaceMap({
      ...payload.data,
      milestones: payload.data.milestones.map((milestone) => ({
        ...milestone,
        targetDate: milestone.targetDate ?? null,
        quests: milestone.quests.map((quest) => ({
          ...quest,
          dueDate: quest.dueDate ?? null,
          estimatedMinutes: quest.estimatedMinutes ?? null,
        })),
      })),
    });
    return jsonNoStore({ ok: true });
  } catch (error) {
    logRouteError("api/map", error);
    return jsonError("Failed to save Quest Map.", 500);
  }
}
