import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { recordBuildImproveDecision } from "@/lib/quest-agent/server/store";
import { buildImproveCheckInputSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = buildImproveCheckInputSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid build/improve payload.", 400);
    }

    const decision = await recordBuildImproveDecision(payload.data);
    return jsonNoStore({ data: decision });
  } catch (error) {
    logRouteError("api/build-improve/check", error);
    return jsonError("Failed to record build/improve decision.", 500);
  }
}
