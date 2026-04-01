import { generateIntakeRefinement } from "@/lib/quest-agent/server/ai";
import { assertAllowedOrigin, jsonError, jsonNoStore, logRouteError } from "@/lib/quest-agent/server/http";
import { intakeRefineRequestSchema } from "@/lib/quest-agent/validation";

export async function POST(request: Request) {
  const originError = assertAllowedOrigin(request);
  if (originError) {
    return originError;
  }

  try {
    const payload = intakeRefineRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return jsonError(payload.error.issues[0]?.message ?? "Invalid intake payload.", 400);
    }

    const refinement = await generateIntakeRefinement(payload.data, payload.data.locale);
    return jsonNoStore({ data: refinement });
  } catch (error) {
    logRouteError("api/ai/intake-refine", error);
    return jsonError("Failed to refine goal.", 500);
  }
}
